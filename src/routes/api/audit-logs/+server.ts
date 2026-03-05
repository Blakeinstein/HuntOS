// src/routes/api/audit-logs/+server.ts
// Audit logs API endpoint — query audit log entries with filtering and pagination

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServices } from '$lib/services';
import { db } from '$lib/db';
import type { AuditLogCategory, AuditLogStatus } from '$lib/services/services/auditLog';

const VALID_CATEGORIES: AuditLogCategory[] = [
	'scrape',
	'browser',
	'resume',
	'agent',
	'profile',
	'application',
	'scheduler'
];
const VALID_STATUSES: AuditLogStatus[] = ['info', 'success', 'warning', 'error'];

export const GET: RequestHandler = async ({ url }) => {
	const services = createServices(db);

	const category = url.searchParams.get('category') ?? undefined;
	const status = url.searchParams.get('status') ?? undefined;
	const agent_id = url.searchParams.get('agent_id') ?? undefined;
	const since = url.searchParams.get('since') ?? undefined;
	const until = url.searchParams.get('until') ?? undefined;
	const search = url.searchParams.get('search') ?? undefined;
	const limitParam = url.searchParams.get('limit');
	const offsetParam = url.searchParams.get('offset');

	// Validate category
	if (category && !VALID_CATEGORIES.includes(category as AuditLogCategory)) {
		return json(
			{ error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` },
			{ status: 400 }
		);
	}

	// Validate status
	if (status && !VALID_STATUSES.includes(status as AuditLogStatus)) {
		return json(
			{ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
			{ status: 400 }
		);
	}

	const limit = limitParam ? Number(limitParam) : 50;
	const offset = offsetParam ? Number(offsetParam) : 0;

	if (Number.isNaN(limit) || limit < 1 || limit > 200) {
		return json({ error: 'limit must be between 1 and 200' }, { status: 400 });
	}
	if (Number.isNaN(offset) || offset < 0) {
		return json({ error: 'offset must be >= 0' }, { status: 400 });
	}

	try {
		const result = services.auditLogService.query({
			category: category as AuditLogCategory | undefined,
			status: status as AuditLogStatus | undefined,
			agent_id,
			since,
			until,
			search,
			limit,
			offset
		});

		return json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to query audit logs';
		return json({ error: message }, { status: 500 });
	}
};
