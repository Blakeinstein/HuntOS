// src/lib/mastra/tools/profile/search-documents.ts
// Agent tool that performs semantic search across the user's uploaded documents
// using sqlite-vec vector similarity. Returns the most relevant chunks so the
// agent can use them as context when answering questions or building the profile.

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { DocumentService } from '$lib/services/services/document';
import type { AuditLogService } from '$lib/services/services/auditLog';

export function createSearchDocumentsTool(
	documentService: DocumentService,
	auditLogService: AuditLogService
) {
	return createTool({
		id: 'search-documents',
		description:
			'Search the user\'s uploaded documents (resumes, cover letters, certificates, etc.) ' +
			'using semantic similarity. Provide a natural language query and this tool will return ' +
			'the most relevant text chunks from across all uploaded documents. ' +
			'\n\nUse this tool when:\n' +
			'- The user asks a question that might be answered by their uploaded documents\n' +
			'- You need to find specific details (dates, company names, certifications) from their documents\n' +
			'- You want to cross-reference information the user mentioned with their documents\n' +
			'- You are building the profile description and want to pull accurate details from source documents\n' +
			'\n\nThe results include the matched text, the source document filename, and a relevance distance ' +
			'(lower distance = more relevant).',
		inputSchema: z.object({
			query: z
				.string()
				.min(3)
				.describe(
					'The natural language search query. Be specific for better results. ' +
					'Examples: "work experience at Google", "Python certifications", ' +
					'"education degree and graduation date", "project management responsibilities".'
				),
			topK: z
				.number()
				.int()
				.min(1)
				.max(20)
				.optional()
				.describe(
					'Number of results to return. Defaults to 5. Use more if you need broader context, ' +
					'fewer if you want only the most relevant match.'
				)
		}),
		outputSchema: z.object({
			success: z.boolean(),
			results: z.array(
				z.object({
					text: z.string().describe('The matched chunk text.'),
					filename: z.string().describe('The source document filename.'),
					documentId: z.number().describe('The source document ID.'),
					chunkIndex: z.number().describe('The ordinal position of this chunk in the document.'),
					distance: z.number().describe('Cosine distance — lower is more relevant (0 = identical).')
				})
			),
			totalDocuments: z.number().describe('Total number of documents in the user\'s library.'),
			message: z.string()
		}),
		execute: async ({ query, topK }) => {
			const resolvedTopK = topK ?? 5;

			const finishAudit = auditLogService.start({
				category: 'profile',
				agent_id: 'profile-agent',
				title: `Document search: "${query.substring(0, 80)}"`,
				detail: `Searching ${resolvedTopK} results across user documents`,
				meta: { query, topK: resolvedTopK }
			});

			try {
				const allDocs = documentService.listDocuments();
				const totalDocuments = allDocs.length;

				if (totalDocuments === 0) {
					finishAudit({
						status: 'info',
						detail: 'No documents uploaded yet — nothing to search.',
						meta: { query, totalDocuments: 0, resultsFound: 0 }
					});

					return {
						success: true,
						results: [],
						totalDocuments: 0,
						message:
							'No documents have been uploaded yet. Ask the user to upload documents ' +
							'(resumes, cover letters, certificates, etc.) in the Documents tab.'
					};
				}

				const searchResults = await documentService.searchDocuments(query, resolvedTopK);

				const results = searchResults.map((r) => ({
					text: r.chunk.text,
					filename: r.document.filename,
					documentId: r.document.id,
					chunkIndex: r.chunk.chunk_index,
					distance: r.distance
				}));

				finishAudit({
					status: 'success',
					detail: `Found ${results.length} results for "${query.substring(0, 80)}"`,
					meta: {
						query,
						topK: resolvedTopK,
						totalDocuments,
						resultsFound: results.length,
						topDistance: results[0]?.distance ?? null
					}
				});

				return {
					success: true,
					results,
					totalDocuments,
					message:
						results.length > 0
							? `Found ${results.length} relevant chunks across ${totalDocuments} document(s). ` +
								`Best match (distance ${results[0]!.distance.toFixed(4)}) is from "${results[0]!.filename}".`
							: `No relevant results found for "${query}" across ${totalDocuments} document(s). ` +
								'Try a different query or ask the user for more details directly.'
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);

				finishAudit({
					status: 'error',
					detail: `Document search failed: ${message}`,
					meta: { query, error: message }
				});

				return {
					success: false,
					results: [],
					totalDocuments: 0,
					message: `Document search failed: ${message}`
				};
			}
		}
	});
}
