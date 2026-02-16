import type { Database } from './database';

export interface Application {
	id: number;
	title: string;
	company: string;
	job_description_url?: string;
	job_description?: string;
	status_swimlane_id: number;
	created_at: string;
	updated_at: string;
	last_activity?: string;
}

export interface ApplicationField {
	id: number;
	application_id: number;
	field_name: string;
	field_value?: string;
	is_required: boolean;
	status: 'pending' | 'filled' | 'missing' | 'user_input_required';
	created_at: string;
	updated_at: string;
}

export interface ApplicationWithSwimlane extends Application {
	swimlane_name: string;
	swimlane_description?: string;
	fields?: ApplicationField[];
}

export interface ApplicationHistory {
	id: number;
	application_id: number;
	swimlane_id: number;
	swimlane_name?: string;
	changed_by: 'system' | 'user' | 'email_monitor';
	reason?: string;
	created_at: string;
}

export class ApplicationService {
	private db: Database;

	constructor(db: Database) {
		this.db = db;
	}

	/**
	 * Get all applications
	 */
	async getApplications(swimlaneId?: number): Promise<ApplicationWithSwimlane[]> {
		const sql = swimlaneId
			? `
      SELECT
        a.id,
        a.title,
        a.company,
        a.job_description_url,
        a.job_description,
        a.status_swimlane_id,
        a.created_at,
        a.updated_at,
        a.last_activity,
        s.name as swimlane_name,
        s.description as swimlane_description
      FROM applications a
      JOIN swimlanes s ON a.status_swimlane_id = s.id
      WHERE a.status_swimlane_id = ?
      ORDER BY a.created_at DESC
    `
			: `
      SELECT
        a.id,
        a.title,
        a.company,
        a.job_description_url,
        a.job_description,
        a.status_swimlane_id,
        a.created_at,
        a.updated_at,
        a.last_activity,
        s.name as swimlane_name,
        s.description as swimlane_description
      FROM applications a
      JOIN swimlanes s ON a.status_swimlane_id = s.id
      ORDER BY a.created_at DESC
    `;

		const applications = await this.db.all(sql, swimlaneId ? [swimlaneId] : []);

		// Fetch fields for each application
		for (const app of applications) {
			app.fields = await this.getApplicationFields(app.id);
		}

		return applications as ApplicationWithSwimlane[];
	}

	/**
	 * Get a single application by ID
	 */
	async getApplication(id: number): Promise<ApplicationWithSwimlane | null> {
		const app = await this.db.get(
			`
      SELECT
        a.id,
        a.title,
        a.company,
        a.job_description_url,
        a.job_description,
        a.status_swimlane_id,
        a.created_at,
        a.updated_at,
        a.last_activity,
        s.name as swimlane_name,
        s.description as swimlane_description
      FROM applications a
      JOIN swimlanes s ON a.status_swimlane_id = s.id
      WHERE a.id = ?
    `,
			[id]
		);

		if (!app) return null;

		const fields = await this.getApplicationFields(id);
		return { ...app, fields } as ApplicationWithSwimlane;
	}

	/**
	 * Get application fields
	 */
	async getApplicationFields(applicationId: number): Promise<ApplicationField[]> {
		return this.db.all(
			`SELECT * FROM application_fields WHERE application_id = ? ORDER BY field_name`,
			[applicationId]
		);
	}

	/**
	 * Create a new application
	 */
	async createApplication(data: {
		title: string;
		company: string;
		job_description_url?: string;
		job_description?: string;
		initialSwimlaneId?: number;
	}): Promise<number> {
		const { title, company, job_description_url, job_description, initialSwimlaneId } = data;

		const defaultSwimlaneId = initialSwimlaneId || (await this.getDefaultBacklogSwimlaneId());

		const sql = `
      INSERT INTO applications (title, company, job_description_url, job_description, status_swimlane_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `;

		const result = await this.db.run(sql, [
			title,
			company,
			job_description_url || null,
			job_description || null,
			defaultSwimlaneId
		]);

		// Log history entry
		await this.db.run(
			`INSERT INTO application_history (application_id, swimlane_id, changed_by, reason, created_at) VALUES (?, ?, 'system', 'Application created', datetime('now'))`,
			[result.lastInsertRowid, defaultSwimlaneId]
		);

		return Number(result.lastInsertRowid);
	}

	/**
	 * Move application to different swimlane
	 */
	async moveApplication(
		applicationId: number,
		newSwimlaneId: number,
		reason?: string,
		changedBy: 'system' | 'user' | 'email_monitor' = 'system'
	): Promise<void> {
		const app = await this.getApplication(applicationId);
		if (!app) {
			throw new Error(`Application ${applicationId} not found`);
		}

		if (app.status_swimlane_id === newSwimlaneId) {
			return; // Already in target swimlane
		}

		await this.db.run(
			`UPDATE applications SET status_swimlane_id = ?, updated_at = datetime('now') WHERE id = ?`,
			[newSwimlaneId, applicationId]
		);

		// Log history entry
		await this.db.run(
			`INSERT INTO application_history (application_id, swimlane_id, changed_by, reason, created_at) VALUES (?, ?, ?, ?, datetime('now'))`,
			[applicationId, newSwimlaneId, changedBy, reason || 'Swimlane changed']
		);
	}

	/**
	 * Update application fields
	 */
	async updateApplicationFields(
		applicationId: number,
		fields: Record<string, string>
	): Promise<void> {
		for (const [fieldName, fieldValue] of Object.entries(fields)) {
			await this.db.run(
				`
        INSERT INTO application_fields (application_id, field_name, field_value, is_required, status, created_at, updated_at)
        VALUES (?, ?, ?, 0, 'filled', datetime('now'), datetime('now'))
        ON CONFLICT(application_id, field_name) DO UPDATE SET
          field_value = excluded.field_value,
          status = 'filled',
          updated_at = datetime('now')
      `,
				[applicationId, fieldName, fieldValue || null]
			);
		}

		await this.db.run(
			`UPDATE applications SET updated_at = datetime('now'), last_activity = datetime('now') WHERE id = ?`,
			[applicationId]
		);
	}

	/**
	 * Get application history
	 */
	async getApplicationHistory(applicationId: number): Promise<ApplicationHistory[]> {
		return this.db.all(
			`
      SELECT ah.*, s.name as swimlane_name
      FROM application_history ah
      JOIN swimlanes s ON ah.swimlane_id = s.id
      WHERE ah.application_id = ?
      ORDER BY ah.created_at ASC
    `,
			[applicationId]
		);
	}

	/**
	 * Delete an application
	 */
	async deleteApplication(applicationId: number): Promise<void> {
		await this.db.run(`DELETE FROM application_fields WHERE application_id = ?`, [applicationId]);
		await this.db.run(`DELETE FROM application_history WHERE application_id = ?`, [applicationId]);
		await this.db.run(`DELETE FROM applications WHERE id = ?`, [applicationId]);
	}

	/**
	 * Get default backlog swimlane ID
	 */
	private async getDefaultBacklogSwimlaneId(): Promise<number> {
		const swimlane = await this.db.get(`SELECT id FROM swimlanes WHERE name = 'Backlog' LIMIT 1`);
		if (!swimlane) {
			throw new Error('Default "Backlog" swimlane not found. Run database initialization.');
		}
		return swimlane.id;
	}

	/**
	 * Get swimlane statistics
	 */
	async getSwimlaneStats(): Promise<{ swimlane_id: number; count: number }[]> {
		return this.db.all(
			`
      SELECT status_swimlane_id as swimlane_id, COUNT(*) as count
      FROM applications
      GROUP BY status_swimlane_id
    `
		);
	}
}
