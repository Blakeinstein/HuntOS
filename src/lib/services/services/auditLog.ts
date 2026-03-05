import type { Database } from './database';

/**
 * Supported audit log categories.
 * Expand this union as new execution types are added.
 */
export type AuditLogCategory =
	| 'scrape'
	| 'browser'
	| 'resume'
	| 'agent'
	| 'profile'
	| 'application'
	| 'scheduler';

/**
 * Severity / outcome status for an audit entry.
 */
export type AuditLogStatus = 'info' | 'success' | 'warning' | 'error';

/**
 * Shape of a single audit log row as stored in the database.
 */
export interface AuditLogEntry {
	id: number;
	category: AuditLogCategory;
	agent_id: string | null;
	status: AuditLogStatus;
	title: string;
	detail: string | null;
	meta: Record<string, unknown> | null;
	duration_ms: number | null;
	created_at: string;
}

/**
 * Raw row coming back from SQLite (meta is stored as a JSON string).
 */
interface AuditLogRow {
	id: number;
	category: string;
	agent_id: string | null;
	status: string;
	title: string;
	detail: string | null;
	meta: string | null;
	duration_ms: number | null;
	created_at: string;
}

/**
 * Options for inserting a new audit log entry.
 */
export interface CreateAuditLogOptions {
	category: AuditLogCategory;
	agent_id?: string | null;
	status: AuditLogStatus;
	title: string;
	detail?: string | null;
	meta?: Record<string, unknown> | null;
	duration_ms?: number | null;
}

/**
 * Filters for querying audit logs.
 */
export interface AuditLogFilters {
	/** Filter by category (e.g. 'scrape'). */
	category?: AuditLogCategory;
	/** Filter by status (e.g. 'error'). */
	status?: AuditLogStatus;
	/** Filter by agent ID (exact match). */
	agent_id?: string;
	/** Only return logs created on or after this ISO timestamp. */
	since?: string;
	/** Only return logs created on or before this ISO timestamp. */
	until?: string;
	/** Free-text search across title and detail columns. */
	search?: string;
	/** Maximum number of rows to return (default 50). */
	limit?: number;
	/** Offset for pagination (default 0). */
	offset?: number;
}

/**
 * Paginated result envelope returned by `query()`.
 */
export interface AuditLogPage {
	logs: AuditLogEntry[];
	total: number;
	limit: number;
	offset: number;
}

/**
 * Service responsible for creating and querying structured audit log
 * entries stored in the `audit_logs` SQLite table.
 *
 * Audit logs provide a persistent, queryable record of agent executions
 * (scraping runs, browser interactions, resume generation, etc.) that is
 * surfaced to the user through the Audit page.
 */
export class AuditLogService {
	private db: Database;

	constructor(db: Database) {
		this.db = db;
	}

	// ── Write ───────────────────────────────────────────────────────

	/**
	 * Insert a single audit log entry.
	 *
	 * @returns The auto-generated row ID.
	 */
	create(opts: CreateAuditLogOptions): number {
		const result = this.db.run(
			`INSERT INTO audit_logs (category, agent_id, status, title, detail, meta, duration_ms)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[
				opts.category,
				opts.agent_id ?? null,
				opts.status,
				opts.title,
				opts.detail ?? null,
				opts.meta ? JSON.stringify(opts.meta) : null,
				opts.duration_ms ?? null
			]
		);
		return Number(result.lastInsertRowid);
	}

	/**
	 * Convenience helper — start a timer and return a `finish` callback
	 * that creates the log entry with the elapsed duration filled in.
	 *
	 * @example
	 * ```ts
	 * const finish = auditLogService.start({
	 *   category: 'scrape',
	 *   agent_id: 'job-board-agent.linkedin',
	 *   title: 'Scraping LinkedIn for "typescript" jobs',
	 * });
	 *
	 * // ... do work ...
	 *
	 * finish({ status: 'success', detail: 'Found 23 jobs' });
	 * ```
	 */
	start(
		opts: Omit<CreateAuditLogOptions, 'status' | 'duration_ms'>
	): (outcome: {
		status: AuditLogStatus;
		detail?: string;
		meta?: Record<string, unknown>;
	}) => number {
		const startedAt = Date.now();
		return (outcome) => {
			const duration_ms = Date.now() - startedAt;
			return this.create({
				...opts,
				status: outcome.status,
				detail: outcome.detail ?? opts.detail ?? null,
				meta: outcome.meta ? { ...opts.meta, ...outcome.meta } : (opts.meta ?? null),
				duration_ms
			});
		};
	}

	// ── Read ────────────────────────────────────────────────────────

	/**
	 * Query audit logs with optional filters and pagination.
	 * Results are returned newest-first.
	 */
	query(filters: AuditLogFilters = {}): AuditLogPage {
		const limit = filters.limit ?? 50;
		const offset = filters.offset ?? 0;

		const conditions: string[] = [];
		const params: unknown[] = [];

		if (filters.category) {
			conditions.push('category = ?');
			params.push(filters.category);
		}
		if (filters.status) {
			conditions.push('status = ?');
			params.push(filters.status);
		}
		if (filters.agent_id) {
			conditions.push('agent_id = ?');
			params.push(filters.agent_id);
		}
		if (filters.since) {
			conditions.push('created_at >= ?');
			params.push(filters.since);
		}
		if (filters.until) {
			conditions.push('created_at <= ?');
			params.push(filters.until);
		}
		if (filters.search) {
			conditions.push('(title LIKE ? OR detail LIKE ?)');
			const term = `%${filters.search}%`;
			params.push(term, term);
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

		// Total count (same filters, no pagination)
		const countRow = this.db.get<{ count: number }>(
			`SELECT COUNT(*) as count FROM audit_logs ${where}`,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			params as any[]
		);
		const total = countRow?.count ?? 0;

		// Paginated rows
		const rows = this.db.all<AuditLogRow>(
			`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			[...params, limit, offset] as any[]
		);

		return {
			logs: rows.map(this.hydrate),
			total,
			limit,
			offset
		};
	}

	/**
	 * Get a single audit log entry by ID.
	 */
	getById(id: number): AuditLogEntry | null {
		const row = this.db.get<AuditLogRow>('SELECT * FROM audit_logs WHERE id = ?', [id]);
		return row ? this.hydrate(row) : null;
	}

	/**
	 * Get all distinct categories that have at least one log entry.
	 * Useful for populating filter dropdowns.
	 */
	getCategories(): string[] {
		const rows = this.db.all<{ category: string }>(
			'SELECT DISTINCT category FROM audit_logs ORDER BY category'
		);
		return rows.map((r) => r.category);
	}

	/**
	 * Get all distinct agent IDs that have at least one log entry.
	 */
	getAgentIds(): string[] {
		const rows = this.db.all<{ agent_id: string }>(
			'SELECT DISTINCT agent_id FROM audit_logs WHERE agent_id IS NOT NULL ORDER BY agent_id'
		);
		return rows.map((r) => r.agent_id);
	}

	/**
	 * Delete audit logs older than a given date. Useful for housekeeping.
	 *
	 * @returns Number of rows deleted.
	 */
	deleteOlderThan(isoDate: string): number {
		const result = this.db.run('DELETE FROM audit_logs WHERE created_at < ?', [isoDate]);
		return result.changes;
	}

	// ── Helpers ─────────────────────────────────────────────────────

	/**
	 * Parse the raw SQLite row into a typed `AuditLogEntry`,
	 * deserializing the JSON `meta` column.
	 */
	private hydrate(row: AuditLogRow): AuditLogEntry {
		let meta: Record<string, unknown> | null = null;
		if (row.meta) {
			try {
				meta = JSON.parse(row.meta);
			} catch {
				meta = null;
			}
		}
		return {
			id: row.id,
			category: row.category as AuditLogCategory,
			agent_id: row.agent_id,
			status: row.status as AuditLogStatus,
			title: row.title,
			detail: row.detail,
			meta,
			duration_ms: row.duration_ms,
			created_at: row.created_at
		};
	}
}
