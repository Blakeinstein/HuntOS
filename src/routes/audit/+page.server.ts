// src/routes/audit/+page.server.ts
// Server load function for the Audit page — queries audit logs with URL-based filters
// Also loads job boards for the live scrape panel board picker.

import type { PageServerLoad } from './$types';
import { createServices } from '$lib/services';
import { db } from '$lib/db';
import type { AuditLogCategory, AuditLogStatus } from '$lib/services/services/auditLog';

const VALID_CATEGORIES: AuditLogCategory[] = [
	'scrape',
	'browser',
	'resume',
	'agent',
	'profile',
	'application'
];
const VALID_STATUSES: AuditLogStatus[] = ['info', 'success', 'warning', 'error'];

export const load: PageServerLoad = async ({ url }) => {
	const services = createServices(db);

	const categoryParam = url.searchParams.get('category');
	const statusParam = url.searchParams.get('status');
	const agent_id = url.searchParams.get('agent_id') ?? undefined;
	const since = url.searchParams.get('since') ?? undefined;
	const until = url.searchParams.get('until') ?? undefined;
	const search = url.searchParams.get('search') ?? undefined;
	const limitParam = url.searchParams.get('limit');
	const offsetParam = url.searchParams.get('offset');

	const category =
		categoryParam && VALID_CATEGORIES.includes(categoryParam as AuditLogCategory)
			? (categoryParam as AuditLogCategory)
			: undefined;

	const status =
		statusParam && VALID_STATUSES.includes(statusParam as AuditLogStatus)
			? (statusParam as AuditLogStatus)
			: undefined;

	const limit = limitParam ? Math.min(Math.max(Number(limitParam) || 50, 1), 200) : 50;
	const offset = offsetParam ? Math.max(Number(offsetParam) || 0, 0) : 0;

	const result = services.auditLogService.query({
		category,
		status,
		agent_id,
		since,
		until,
		search,
		limit,
		offset
	});

	// Fetch available filter options for the dropdowns
	const categories = services.auditLogService.getCategories();
	const agentIds = services.auditLogService.getAgentIds();

	// Load enabled job boards for the live scrape panel picker
	const jobBoards = (await services.jobBoardService.getJobBoards()).filter((b) => b.is_enabled);

	return {
		auditLogs: result.logs,
		total: result.total,
		limit: result.limit,
		offset: result.offset,
		filters: {
			category: category ?? null,
			status: status ?? null,
			agent_id: agent_id ?? null,
			since: since ?? null,
			until: until ?? null,
			search: search ?? null
		},
		filterOptions: {
			categories,
			agentIds,
			statuses: VALID_STATUSES
		},
		jobBoards: jobBoards.map((b) => ({
			id: b.id,
			name: b.name,
			base_url: b.base_url
		}))
	};
};
