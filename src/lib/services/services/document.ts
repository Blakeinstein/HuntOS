// src/lib/services/services/document.ts
// Service for managing user-uploaded documents with RAG capabilities.
// Handles CRUD, chunking (via @mastra/rag), embedding (via AI SDK), and
// vector storage/retrieval (via sqlite-vec).

import type { Database } from './database';
import type { AuditLogService } from './auditLog';
import { MDocument } from '@mastra/rag';
import { embedMany, embed } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { OPENROUTER_API_KEY } from '$env/static/private';

// ── Types ───────────────────────────────────────────────────────────

export interface UserDocument {
	id: number;
	user_id: number;
	filename: string;
	mime_type: string;
	content_type: DocumentContentType;
	raw_text: string;
	size_bytes: number;
	chunk_count: number;
	created_at: string;
	updated_at: string;
}

export interface DocumentChunk {
	id: number;
	document_id: number;
	chunk_index: number;
	text: string;
	metadata: Record<string, unknown> | null;
	created_at: string;
}

export interface DocumentSearchResult {
	chunk: DocumentChunk;
	document: Pick<UserDocument, 'id' | 'filename' | 'content_type'>;
	distance: number;
}

export interface CreateDocumentOptions {
	filename: string;
	mimeType: string;
	rawText: string;
}

export type DocumentContentType = 'text' | 'pdf' | 'html' | 'markdown';

// Embedding model configuration
// Using OpenRouter with OpenAI's text-embedding-3-small model.
// 384 dimensions — must match the vec0 table definition in database.ts.
// We pass dimensions via the AI SDK `experimental_providerOptions` so the
// upstream provider truncates the vector server-side.
const EMBEDDING_DIMENSIONS = 384;
const EMBEDDING_MODEL = 'openai/text-embedding-3-small';

// Chunking defaults
const DEFAULT_CHUNK_MAX_SIZE = 512;
const DEFAULT_CHUNK_OVERLAP = 50;

// ── Service ─────────────────────────────────────────────────────────

export class DocumentService {
	private db: Database;
	private auditLog: AuditLogService;

	constructor(db: Database, auditLogService: AuditLogService) {
		this.db = db;
		this.auditLog = auditLogService;
	}

	// ── Queries ────────────────────────────────────────────────────

	/**
	 * List all documents for a user.
	 */
	listDocuments(userId: number = 1): UserDocument[] {
		return this.db.all<UserDocument>(
			`SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC`,
			[userId]
		);
	}

	/**
	 * Get a single document by ID.
	 */
	getDocument(id: number): UserDocument | null {
		return this.db.get<UserDocument>(`SELECT * FROM documents WHERE id = ?`, [id]);
	}

	/**
	 * Get all chunks for a document.
	 */
	getChunks(documentId: number): DocumentChunk[] {
		const rows = this.db.all<DocumentChunk & { metadata: string | null }>(
			`SELECT * FROM document_chunks WHERE document_id = ? ORDER BY chunk_index`,
			[documentId]
		);
		return rows.map((r) => ({
			...r,
			metadata: r.metadata ? JSON.parse(r.metadata) : null
		}));
	}

	// ── Create + Ingest ───────────────────────────────────────────

	/**
	 * Create a document, chunk it, embed it, and store vectors.
	 * Returns the created document with chunk_count populated.
	 */
	async createDocument(opts: CreateDocumentOptions): Promise<UserDocument> {
		const contentType = this.detectContentType(opts.mimeType, opts.filename);
		const sizeBytes = Buffer.byteLength(opts.rawText, 'utf-8');

		const finishAudit = this.auditLog.start({
			category: 'profile',
			agent_id: 'document-service',
			title: `Ingesting document: ${opts.filename}`,
			detail: `Content type: ${contentType}, size: ${sizeBytes} bytes`,
			meta: { filename: opts.filename, contentType, sizeBytes }
		});

		try {
			// 1. Insert the document row
			const result = this.db.run(
				`INSERT INTO documents (user_id, filename, mime_type, content_type, raw_text, size_bytes)
				 VALUES (1, ?, ?, ?, ?, ?)`,
				[opts.filename, opts.mimeType, contentType, opts.rawText, sizeBytes]
			);
			const documentId = Number(result.lastInsertRowid);

			// 2. Chunk the document
			const chunks = await this.chunkDocument(opts.rawText, contentType);

			// 3. Insert chunk rows
			const chunkIds: number[] = [];
			for (let i = 0; i < chunks.length; i++) {
				const chunk = chunks[i]!;
				const chunkResult = this.db.run(
					`INSERT INTO document_chunks (document_id, chunk_index, text, metadata)
					 VALUES (?, ?, ?, ?)`,
					[documentId, i, chunk.text, chunk.metadata ? JSON.stringify(chunk.metadata) : null]
				);
				chunkIds.push(Number(chunkResult.lastInsertRowid));
			}

			// 4. Generate embeddings
			const embeddings = await this.embedTexts(chunks.map((c) => c.text));

			// 5. Store vectors in sqlite-vec
			this.upsertVectors(chunkIds, embeddings);

			// 6. Update chunk_count on the document
			this.db.run(
				`UPDATE documents SET chunk_count = ?, updated_at = datetime('now') WHERE id = ?`,
				[chunks.length, documentId]
			);

			finishAudit({
				status: 'success',
				detail: `Ingested ${opts.filename}: ${chunks.length} chunks, ${sizeBytes} bytes`,
				meta: { documentId, chunkCount: chunks.length, sizeBytes }
			});

			return this.getDocument(documentId)!;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			finishAudit({
				status: 'error',
				detail: `Failed to ingest ${opts.filename}: ${message}`,
				meta: { error: message }
			});
			throw error;
		}
	}

	// ── Delete ─────────────────────────────────────────────────────

	/**
	 * Delete a document and all its chunks + vectors.
	 */
	deleteDocument(id: number): boolean {
		// Get chunk IDs so we can remove their vectors
		const chunkRows = this.db.all<{ id: number }>(
			`SELECT id FROM document_chunks WHERE document_id = ?`,
			[id]
		);
		const chunkIds = chunkRows.map((r) => r.id);

		// Delete vectors from vec0
		if (chunkIds.length > 0) {
			const placeholders = chunkIds.map(() => '?').join(', ');
			this.db.run(`DELETE FROM document_chunks_vec WHERE chunk_id IN (${placeholders})`, chunkIds);
		}

		// Delete chunks (CASCADE should handle this too, but be explicit)
		this.db.run(`DELETE FROM document_chunks WHERE document_id = ?`, [id]);

		// Delete the document itself
		const result = this.db.run(`DELETE FROM documents WHERE id = ?`, [id]);
		return result.changes > 0;
	}

	// ── Vector Search ──────────────────────────────────────────────

	/**
	 * Semantic search across all document chunks.
	 *
	 * @param query - Natural language query text
	 * @param topK  - Number of results to return (default 5)
	 * @returns Ranked results with chunk text, document info, and distance
	 */
	async searchDocuments(query: string, topK: number = 5): Promise<DocumentSearchResult[]> {
		// 1. Embed the query
		const queryEmbedding = await this.embedSingle(query);

		// 2. Query the vec0 virtual table
		// sqlite-vec uses the `vec_distance_cosine` or KNN syntax.
		// The KNN query uses `WHERE embedding MATCH ? AND k = ?` syntax.
		const raw = this.db.raw;
		const stmt = raw.prepare(`
			SELECT
				v.chunk_id,
				v.distance
			FROM document_chunks_vec v
			WHERE v.embedding MATCH ?
			  AND k = ?
			ORDER BY v.distance
		`);

		const vecRows = stmt.all(
			new Float32Array(queryEmbedding).buffer as ArrayBuffer,
			topK
		) as Array<{ chunk_id: number; distance: number }>;

		if (vecRows.length === 0) return [];

		// 3. Hydrate with chunk text + document metadata
		const results: DocumentSearchResult[] = [];
		for (const row of vecRows) {
			const chunk = this.db.get<DocumentChunk & { metadata: string | null }>(
				`SELECT * FROM document_chunks WHERE id = ?`,
				[row.chunk_id]
			);
			if (!chunk) continue;

			const doc = this.db.get<Pick<UserDocument, 'id' | 'filename' | 'content_type'>>(
				`SELECT id, filename, content_type FROM documents WHERE id = ?`,
				[chunk.document_id]
			);
			if (!doc) continue;

			results.push({
				chunk: {
					...chunk,
					metadata: chunk.metadata ? JSON.parse(chunk.metadata) : null
				},
				document: doc,
				distance: row.distance
			});
		}

		return results;
	}

	// ── Internals ──────────────────────────────────────────────────

	/**
	 * Chunk a document's text using @mastra/rag.
	 */
	private async chunkDocument(
		text: string,
		contentType: DocumentContentType
	): Promise<Array<{ text: string; metadata?: Record<string, unknown> }>> {
		let doc: MDocument;

		switch (contentType) {
			case 'html':
				doc = MDocument.fromHTML(text);
				break;
			case 'markdown':
				doc = MDocument.fromMarkdown(text);
				break;
			default:
				doc = MDocument.fromText(text);
				break;
		}

		const strategy = contentType === 'markdown' ? 'markdown' : 'recursive';

		const chunks = await doc.chunk({
			strategy,
			maxSize: DEFAULT_CHUNK_MAX_SIZE,
			overlap: DEFAULT_CHUNK_OVERLAP
		});

		// MDocument.chunk() returns Chunk[] which have .text and .metadata
		return chunks.map((c) => ({
			text:
				typeof c === 'string'
					? c
					: (c as { text: string; metadata?: Record<string, unknown> }).text,
			metadata:
				typeof c === 'string'
					? undefined
					: (c as { text: string; metadata?: Record<string, unknown> }).metadata
		}));
	}

	/**
	 * Generate embeddings for multiple texts using the AI SDK via OpenRouter.
	 */
	private async embedTexts(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) return [];

		const openrouter = createOpenRouter({ apiKey: OPENROUTER_API_KEY });

		const { embeddings } = await embedMany({
			model: openrouter.textEmbeddingModel(EMBEDDING_MODEL),
			values: texts,
			providerOptions: {
				openai: { dimensions: EMBEDDING_DIMENSIONS }
			}
		});

		return embeddings;
	}

	/**
	 * Generate a single embedding for a query string.
	 */
	private async embedSingle(text: string): Promise<number[]> {
		const openrouter = createOpenRouter({ apiKey: OPENROUTER_API_KEY });

		const { embedding } = await embed({
			model: openrouter.textEmbeddingModel(EMBEDDING_MODEL),
			value: text,
			providerOptions: {
				openai: { dimensions: EMBEDDING_DIMENSIONS }
			}
		});

		return embedding;
	}

	/**
	 * Insert embedding vectors into the sqlite-vec virtual table.
	 * Each vector is associated with a chunk_id from document_chunks.
	 */
	private upsertVectors(chunkIds: number[], embeddings: number[][]): void {
		const raw = this.db.raw;
		const stmt = raw.prepare(`INSERT INTO document_chunks_vec (chunk_id, embedding) VALUES (?, ?)`);

		const insertMany = raw.transaction((ids: number[], vecs: number[][]) => {
			for (let i = 0; i < ids.length; i++) {
				const vec = new Float32Array(vecs[i]!);
				stmt.run(ids[i], vec.buffer as ArrayBuffer);
			}
		});

		insertMany(chunkIds, embeddings);
	}

	/**
	 * Detect content type from MIME type or filename extension.
	 */
	private detectContentType(mimeType: string, filename: string): DocumentContentType {
		const lower = mimeType.toLowerCase();
		if (lower.includes('html')) return 'html';
		if (lower.includes('markdown') || filename.endsWith('.md') || filename.endsWith('.mdx'))
			return 'markdown';
		if (lower.includes('pdf')) return 'pdf';
		return 'text';
	}
}
