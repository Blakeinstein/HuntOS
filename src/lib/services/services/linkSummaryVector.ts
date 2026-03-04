// src/lib/services/services/linkSummaryVector.ts
// Vector embedding service for link summaries.
//
// Responsibility: embed completed link summaries into a sqlite-vec virtual
// table (link_summary_vec) so the resume agent can perform semantic similarity
// search across portfolio, GitHub, LinkedIn, and other profile-link content.
//
// Architecture mirrors DocumentService's vector layer — same embedding model,
// same 384-dimension layout, same KNN query pattern — but is scoped to the
// link_summaries table rather than document_chunks.

import type { Database } from './database';
import type { AuditLogService } from './auditLog';
import { embed, embedMany } from 'ai';
import { env } from '$env/dynamic/private';
import { resolveEmbeddingModel } from '$lib/mastra/providers';

// ── Constants ────────────────────────────────────────────────────────────────

/** Must match the dimension declared in the link_summary_vec CREATE VIRTUAL TABLE. */
const EMBEDDING_DIMENSIONS = 384;

function getEmbeddingModel(): string {
	return env.EMBEDDING_MODEL ?? 'openrouter/openai/text-embedding-3-small';
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LinkSummarySearchResult {
	/** Primary key of the matching link_summaries row. */
	linkSummaryId: number;
	/** Human-readable title of the link (e.g. "GitHub", "Portfolio"). */
	linkTitle: string;
	/** The URL that was summarised. */
	linkUrl: string;
	/** The full summary text that matched. */
	summary: string;
	/** Summary type for context (github | linkedin | portfolio | generic). */
	summaryType: string;
	/** Cosine distance — lower is more relevant (0 = identical). */
	distance: number;
}

// ── Service ──────────────────────────────────────────────────────────────────

/**
 * Manages vector embeddings for link summaries.
 *
 * Each completed link summary is stored as a single embedding vector keyed by
 * the link_summary id. Re-indexing a summary (e.g. after re-scraping) deletes
 * the old vector and inserts a fresh one.
 *
 * The sqlite-vec virtual table `link_summary_vec` must exist before any
 * method on this service is called — it is created in Database.init() via
 * the same guard pattern used for `document_chunks_vec`.
 */
export class LinkSummaryVectorService {
	private db: Database;
	private auditLog: AuditLogService;

	constructor(db: Database, auditLogService: AuditLogService) {
		this.db = db;
		this.auditLog = auditLogService;
	}

	// ── Write ─────────────────────────────────────────────────────────────────

	/**
	 * Embed a single link summary and upsert it into the vector table.
	 *
	 * Idempotent: if a vector already exists for this `linkSummaryId` it is
	 * deleted and re-inserted so the embedding reflects the latest summary text.
	 *
	 * Call this whenever a summary transitions to `status = 'done'`.
	 */
	async upsertEmbedding(linkSummaryId: number, text: string): Promise<void> {
		const finishAudit = this.auditLog.start({
			category: 'profile',
			agent_id: 'link-summary-vector',
			title: `Embedding link summary #${linkSummaryId}`,
			detail: `Text length: ${text.length} chars`,
			meta: { linkSummaryId, textLength: text.length }
		});

		try {
			const embedding = await this.embedSingle(text);
			this.upsertVector(linkSummaryId, embedding);

			finishAudit({
				status: 'success',
				detail: `Embedded link summary #${linkSummaryId} (${EMBEDDING_DIMENSIONS}d)`,
				meta: { linkSummaryId }
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			finishAudit({
				status: 'error',
				detail: `Failed to embed link summary #${linkSummaryId}: ${message}`,
				meta: { linkSummaryId, error: message }
			});
			throw error;
		}
	}

	/**
	 * Re-embed all link summaries that have `status = 'done'` but no
	 * corresponding vector in `link_summary_vec`.
	 *
	 * Useful as a one-time backfill after the migration, and as a repair
	 * step if the vector table is ever rebuilt from scratch.
	 *
	 * @returns Number of summaries that were (re-)indexed.
	 */
	async backfillMissingEmbeddings(): Promise<number> {
		const rows = this.db.all<{ id: number; summary: string }>(
			`SELECT ls.id, ls.summary
			 FROM link_summaries ls
			 LEFT JOIN link_summary_vec v ON v.link_summary_id = ls.id
			 WHERE ls.status = 'done'
			   AND ls.summary != ''
			   AND v.link_summary_id IS NULL`
		);

		if (rows.length === 0) return 0;

		const texts = rows.map((r) => r.summary);
		const embeddings = await this.embedBatch(texts);

		for (let i = 0; i < rows.length; i++) {
			this.upsertVector(rows[i]!.id, embeddings[i]!);
		}

		return rows.length;
	}

	/**
	 * Remove the vector for a link summary.
	 * Call when the parent link summary is deleted or reset.
	 */
	deleteEmbedding(linkSummaryId: number): void {
		this.db.run(`DELETE FROM link_summary_vec WHERE link_summary_id = ?`, [linkSummaryId]);
	}

	// ── Read / Search ─────────────────────────────────────────────────────────

	/**
	 * Semantic search across all indexed link summaries.
	 *
	 * @param query  Natural-language query string.
	 * @param topK   Max number of results to return (default 5).
	 * @returns Ranked results ordered by cosine distance (ascending).
	 */
	async search(query: string, topK: number = 5): Promise<LinkSummarySearchResult[]> {
		// 1. Embed the query
		const queryEmbedding = await this.embedSingle(query);

		// 2. KNN query against the vec0 virtual table
		const raw = this.db.raw;
		const stmt = raw.prepare(`
			SELECT
				v.link_summary_id,
				v.distance
			FROM link_summary_vec v
			WHERE v.embedding MATCH ?
			  AND k = ?
			ORDER BY v.distance
		`);

		const vecRows = stmt.all(
			new Float32Array(queryEmbedding).buffer as ArrayBuffer,
			topK
		) as Array<{ link_summary_id: number; distance: number }>;

		if (vecRows.length === 0) return [];

		// 3. Hydrate with the full summary row
		const results: LinkSummarySearchResult[] = [];

		for (const row of vecRows) {
			const summary = this.db.get<{
				id: number;
				link_title: string;
				link_url: string;
				summary: string;
				summary_type: string;
			}>(
				`SELECT id, link_title, link_url, summary, summary_type
				 FROM link_summaries
				 WHERE id = ?`,
				[row.link_summary_id]
			);

			if (!summary) continue;

			results.push({
				linkSummaryId: summary.id,
				linkTitle: summary.link_title,
				linkUrl: summary.link_url,
				summary: summary.summary,
				summaryType: summary.summary_type,
				distance: row.distance
			});
		}

		return results;
	}

	/**
	 * Return all indexed link summaries as plain text blocks.
	 * Used when the caller wants to inject the full set of summaries as
	 * context rather than performing a query-specific vector search.
	 *
	 * Only returns summaries with `status = 'done'` and non-empty text.
	 */
	getAllSummariesAsText(): string {
		const rows = this.db.all<{
			link_title: string;
			link_url: string;
			summary: string;
			summary_type: string;
		}>(
			`SELECT link_title, link_url, summary, summary_type
			 FROM link_summaries
			 WHERE status = 'done' AND summary != ''
			 ORDER BY updated_at DESC`
		);

		if (rows.length === 0) return '';

		return rows
			.map((r) =>
				[
					`### ${r.link_title} (${r.summary_type})`,
					`URL: ${r.link_url}`,
					'',
					r.summary.trim()
				].join('\n')
			)
			.join('\n\n---\n\n');
	}

	/**
	 * Return the count of currently indexed link summary vectors.
	 */
	getIndexedCount(): number {
		const row = this.db.get<{ count: number }>(
			`SELECT COUNT(*) AS count FROM link_summary_vec`
		);
		return row?.count ?? 0;
	}

	// ── Internals ─────────────────────────────────────────────────────────────

	private async embedSingle(text: string): Promise<number[]> {
		const model = resolveEmbeddingModel(getEmbeddingModel());
		const { embedding } = await embed({
			model,
			value: text,
			providerOptions: {
				openai: { dimensions: EMBEDDING_DIMENSIONS }
			}
		});
		return embedding;
	}

	private async embedBatch(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) return [];
		const model = resolveEmbeddingModel(getEmbeddingModel());
		const { embeddings } = await embedMany({
			model,
			values: texts,
			providerOptions: {
				openai: { dimensions: EMBEDDING_DIMENSIONS }
			}
		});
		return embeddings;
	}

	/**
	 * Insert or replace a vector for the given link summary id.
	 * Uses DELETE + INSERT rather than ON CONFLICT because vec0 virtual
	 * tables do not support the standard SQLite upsert syntax.
	 */
	private upsertVector(linkSummaryId: number, embedding: number[]): void {
		const raw = this.db.raw;

		const del = raw.prepare(`DELETE FROM link_summary_vec WHERE link_summary_id = ?`);
		const ins = raw.prepare(
			`INSERT INTO link_summary_vec (link_summary_id, embedding) VALUES (?, ?)`
		);

		const upsert = raw.transaction((id: number, vec: number[]) => {
			del.run(id);
			ins.run(id, new Float32Array(vec).buffer as ArrayBuffer);
		});

		upsert(linkSummaryId, embedding);
	}
}
