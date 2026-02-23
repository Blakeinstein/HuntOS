import type { Database } from './database';

// ── Types ───────────────────────────────────────────────────────────

export type ResourceType =
	| 'job_description'
	| 'company_info'
	| 'role_research'
	| 'resume'
	| 'error';

export interface ApplicationResource {
	id: number;
	application_id: number;
	resource_type: ResourceType;
	title: string;
	content: string;
	meta: Record<string, unknown> | null;
	created_at: string;
}

interface ApplicationResourceRow {
	id: number;
	application_id: number;
	resource_type: string;
	title: string;
	content: string;
	meta: string | null;
	created_at: string;
}

export interface CreateResourceOptions {
	applicationId: number;
	resourceType: ResourceType;
	title: string;
	content: string;
	meta?: Record<string, unknown> | null;
}

// ── Service ─────────────────────────────────────────────────────────

/**
 * Manages research data and resources gathered during the apply pipeline.
 *
 * Resources include job descriptions, company research, role analysis,
 * generated resumes, and error logs — all linked to a specific application.
 */
export class ApplicationResourceService {
	private db: Database;

	constructor(db: Database) {
		this.db = db;
	}

	// ── Write ───────────────────────────────────────────────────────

	/**
	 * Create a new resource entry for an application.
	 *
	 * @returns The auto-generated row ID.
	 */
	create(opts: CreateResourceOptions): number {
		const result = this.db.run(
			`INSERT INTO application_resources (application_id, resource_type, title, content, meta)
			 VALUES (?, ?, ?, ?, ?)`,
			[
				opts.applicationId,
				opts.resourceType,
				opts.title,
				opts.content,
				opts.meta ? JSON.stringify(opts.meta) : null
			]
		);
		return Number(result.lastInsertRowid);
	}

	// ── Read ────────────────────────────────────────────────────────

	/**
	 * Get all resources for an application, optionally filtered by type.
	 * Results are returned newest-first.
	 */
	getByApplicationId(applicationId: number, resourceType?: ResourceType): ApplicationResource[] {
		const conditions = ['application_id = ?'];
		const params: unknown[] = [applicationId];

		if (resourceType) {
			conditions.push('resource_type = ?');
			params.push(resourceType);
		}

		const where = conditions.join(' AND ');
		const rows = this.db.all<ApplicationResourceRow>(
			`SELECT * FROM application_resources WHERE ${where} ORDER BY created_at DESC`,
			params as unknown[]
		);

		return rows.map((row) => this.hydrate(row));
	}

	/**
	 * Get a single resource by ID.
	 */
	getById(id: number): ApplicationResource | null {
		const row = this.db.get<ApplicationResourceRow>(
			'SELECT * FROM application_resources WHERE id = ?',
			[id]
		);
		return row ? this.hydrate(row) : null;
	}

	// ── Delete ──────────────────────────────────────────────────────

	/**
	 * Delete a single resource by ID.
	 *
	 * @returns `true` if the resource was found and deleted.
	 */
	delete(id: number): boolean {
		const result = this.db.run('DELETE FROM application_resources WHERE id = ?', [id]);
		return result.changes > 0;
	}

	/**
	 * Delete all resources for an application, optionally filtered by type.
	 *
	 * @returns Number of rows deleted.
	 */
	deleteByApplicationId(applicationId: number, resourceType?: ResourceType): number {
		if (resourceType) {
			const result = this.db.run(
				'DELETE FROM application_resources WHERE application_id = ? AND resource_type = ?',
				[applicationId, resourceType]
			);
			return result.changes;
		}

		const result = this.db.run('DELETE FROM application_resources WHERE application_id = ?', [
			applicationId
		]);
		return result.changes;
	}

	// ── Helpers ─────────────────────────────────────────────────────

	/**
	 * Parse the raw SQLite row into a typed `ApplicationResource`,
	 * deserializing the JSON `meta` column.
	 */
	private hydrate(row: ApplicationResourceRow): ApplicationResource {
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
			application_id: row.application_id,
			resource_type: row.resource_type as ResourceType,
			title: row.title,
			content: row.content,
			meta,
			created_at: row.created_at
		};
	}
}
