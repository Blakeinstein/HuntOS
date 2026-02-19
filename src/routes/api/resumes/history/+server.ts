// src/routes/api/resumes/history/+server.ts
// Resume history API — list history entries with filtering/pagination, and purge all.

import { json, type RequestEvent } from '@sveltejs/kit';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

const services = createServices(db);

/**
 * GET /api/resumes/history
 *
 * Query resume history with optional filters and pagination.
 *
 * Query params:
 *   search  — free-text search across name and job_description
 *   limit   — max rows (1–200, default 50)
 *   offset  — pagination offset (default 0)
 */
export async function GET({ url }: RequestEvent) {
	const search = url.searchParams.get('search') ?? undefined;
	const limitParam = url.searchParams.get('limit');
	const offsetParam = url.searchParams.get('offset');

	const limit = limitParam ? Math.min(Math.max(Number(limitParam) || 50, 1), 200) : 50;
	const offset = offsetParam ? Math.max(Number(offsetParam) || 0, 0) : 0;

	if (Number.isNaN(limit) || limit < 1 || limit > 200) {
		return json({ error: 'limit must be between 1 and 200' }, { status: 400 });
	}
	if (Number.isNaN(offset) || offset < 0) {
		return json({ error: 'offset must be >= 0' }, { status: 400 });
	}

	try {
		const result = services.resumeHistoryService.query({ search, limit, offset });
		return json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to query resume history';
		return json({ error: message }, { status: 500 });
	}
}

/**
 * DELETE /api/resumes/history
 *
 * Purge all resume history entries and their files on disk.
 *
 * Body (optional JSON):
 *   { ids: number[] }  — if provided, delete only those specific entries
 *
 * If no body or empty ids array, purges everything.
 */
export async function DELETE({ request }: RequestEvent) {
	try {
		let ids: number[] | undefined;

		// Try to parse a JSON body — it's optional
		const contentType = request.headers.get('content-type') || '';
		if (contentType.includes('application/json')) {
			try {
				const body = await request.json();
				if (Array.isArray(body?.ids) && body.ids.length > 0) {
					ids = body.ids.map(Number).filter((n: number) => !Number.isNaN(n));
				}
			} catch {
				// No body or invalid JSON — treat as purge-all
			}
		}

		let deleted: number;
		let action: string;

		if (ids && ids.length > 0) {
			deleted = services.resumeHistoryService.deleteMany(ids);
			action = `Deleted ${deleted} specific resume history entries`;
		} else {
			deleted = services.resumeHistoryService.purgeAll();
			action = `Purged all ${deleted} resume history entries`;
		}

		// Audit the purge/delete action
		services.auditLogService.create({
			category: 'resume',
			status: 'info',
			title: action,
			detail: ids ? `IDs: ${ids.join(', ')}` : 'Full purge requested',
			meta: { deleted, ids: ids ?? null }
		});

		return json({ deleted, message: action });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to delete resume history';
		return json({ error: message }, { status: 500 });
	}
}
