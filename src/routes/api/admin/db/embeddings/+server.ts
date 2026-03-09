// src/routes/api/admin/db/embeddings/+server.ts
// Admin API to wipe and regenerate all vector embeddings.
//
// POST /api/admin/db/embeddings
//   Clears document_chunks_vec and link_summary_vec, then re-embeds all
//   stored chunks / completed link summaries from scratch.
//   Returns counts of re-indexed items for both stores.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

const services = createServices(db);

/**
 * POST /api/admin/db/embeddings
 * Regenerates all vector embeddings for documents and link summaries.
 */
export const POST: RequestHandler = async () => {
	try {
		const [chunksReindexed, summariesReindexed] = await Promise.all([
			services.documentService.regenAllEmbeddings(),
			services.linkSummaryVectorService.regenAllEmbeddings()
		]);

		return json({
			ok: true,
			chunksReindexed,
			summariesReindexed,
			total: chunksReindexed + summariesReindexed
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to regenerate embeddings';
		console.error('[api/admin/db/embeddings] Regeneration error:', error);
		return json({ error: message }, { status: 500 });
	}
};
