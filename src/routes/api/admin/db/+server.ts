// src/routes/api/admin/db/+server.ts
// Admin API for DB introspection: list tables, query rows, wipe a table.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';

// Tables that are protected from wipe (safety guard)
const PROTECTED_TABLES = new Set(['sqlite_master', 'sqlite_sequence']);

function getUserTables(): string[] {
	return db
		.all<{ name: string }>(
			`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
		)
		.map((r) => r.name);
}

function getTableInfo(table: string): { name: string; type: string }[] {
	// Validate table name is a real user table to prevent SQL injection
	const tables = getUserTables();
	if (!tables.includes(table)) return [];
	return db.all<{ name: string; type: string }>(`PRAGMA table_info("${table}")`).map((r) => ({
		name: r.name,
		type: r.type
	}));
}

/**
 * GET /api/admin/db
 * List all user tables with row counts and column info.
 *
 * GET /api/admin/db?table=foo&limit=50&offset=0
 * Query rows from a specific table.
 */
export const GET: RequestHandler = async ({ url }) => {
	const table = url.searchParams.get('table');

	if (!table) {
		// Return all tables with metadata
		const tables = getUserTables();
		const result = tables.map((name) => {
			const countRow = db.get<{ count: number }>(`SELECT COUNT(*) as count FROM "${name}"`);
			const columns = getTableInfo(name);
			return { name, rowCount: countRow?.count ?? 0, columns };
		});
		return json(result);
	}

	// Validate table exists
	const tables = getUserTables();
	if (!tables.includes(table)) {
		return json({ error: `Table "${table}" not found` }, { status: 404 });
	}

	const limit = Math.min(Number(url.searchParams.get('limit') ?? '100'), 500);
	const offset = Math.max(Number(url.searchParams.get('offset') ?? '0'), 0);

	if (Number.isNaN(limit) || Number.isNaN(offset)) {
		return json({ error: 'Invalid limit or offset' }, { status: 400 });
	}

	const countRow = db.get<{ count: number }>(`SELECT COUNT(*) as count FROM "${table}"`);
	const total = countRow?.count ?? 0;
	const rows = db.all(`SELECT * FROM "${table}" ORDER BY rowid DESC LIMIT ? OFFSET ?`, [
		limit,
		offset
	]);
	const columns = getTableInfo(table);

	return json({ table, columns, rows, total, limit, offset });
};

/**
 * DELETE /api/admin/db
 * Body: { table: string }
 * Wipes all rows from the given table (DELETE FROM, not DROP).
 */
export const DELETE: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const table: unknown = body?.table;

	if (typeof table !== 'string' || !table) {
		return json({ error: 'Missing required field: table' }, { status: 400 });
	}

	if (PROTECTED_TABLES.has(table)) {
		return json({ error: `Table "${table}" is protected and cannot be wiped` }, { status: 403 });
	}

	const tables = getUserTables();
	if (!tables.includes(table)) {
		return json({ error: `Table "${table}" not found` }, { status: 404 });
	}

	const result = db.run(`DELETE FROM "${table}"`);
	return json({ table, deleted: result.changes });
};

/**
 * PATCH /api/admin/db
 * Body: { table: string, rowid: number, column: string, value: unknown }
 * Update a single cell in a table row.
 */
export const PATCH: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const { table, rowid, column, value } = body ?? {};

	if (typeof table !== 'string' || !table) {
		return json({ error: 'Missing required field: table' }, { status: 400 });
	}
	if (typeof rowid !== 'number') {
		return json({ error: 'Missing required field: rowid (number)' }, { status: 400 });
	}
	if (typeof column !== 'string' || !column) {
		return json({ error: 'Missing required field: column' }, { status: 400 });
	}

	const tables = getUserTables();
	if (!tables.includes(table)) {
		return json({ error: `Table "${table}" not found` }, { status: 404 });
	}

	// Validate column exists on the table
	const columns = getTableInfo(table);
	if (!columns.find((c) => c.name === column)) {
		return json({ error: `Column "${column}" not found in table "${table}"` }, { status: 404 });
	}

	db.run(`UPDATE "${table}" SET "${column}" = ? WHERE rowid = ?`, [value ?? null, rowid]);
	const updated = db.get(`SELECT * FROM "${table}" WHERE rowid = ?`, [rowid]);

	return json({ table, rowid, updated });
};
