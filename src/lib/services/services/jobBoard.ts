import type { Database } from './database';

export interface JobBoardConfig {
	id: number;
	name: string;
	base_url: string;
	check_interval_minutes: number;
	last_checked?: string;
	next_check?: string;
	is_enabled: boolean;
	created_at: string;
}

export interface JobBoardCredentials {
	id: number;
	job_board_id: number;
	username?: string;
	session_cookie?: string;
	created_at: string;
	updated_at: string;
}

export interface JobPosting {
	id?: number;
	job_board_id: number;
	title: string;
	company: string;
	location?: string;
	salary_range?: string;
	job_description_url: string;
	job_description?: string;
	posted_at: string;
	created_at: string;
	application_id?: number;
}

export interface JobBoardSearchResult {
	postings: JobPosting[];
	nextCheck: string;
}

export interface SearchQueryConfig {
	queries: string[];
	location?: string;
	isRemote: boolean;
}

export class JobBoardService {
	private db: Database;

	constructor(db: Database) {
		this.db = db;
	}

	/**
	 * Get all job boards
	 */
	async getJobBoards(): Promise<JobBoardConfig[]> {
		return this.db.all(`SELECT * FROM job_boards ORDER BY name ASC`);
	}

	/**
	 * Get a single job board by ID
	 */
	async getJobBoard(id: number): Promise<JobBoardConfig | null> {
		return this.db.get(`SELECT * FROM job_boards WHERE id = ?`, [id]);
	}

	/**
	 * Create a new job board configuration
	 */
	async createJobBoard(config: {
		name: string;
		baseUrl: string;
		checkIntervalMinutes?: number;
		searchQueries?: string[];
	}): Promise<number> {
		const { name, baseUrl, checkIntervalMinutes = 1440 } = config;

		const result = await this.db.run(
			`
      INSERT INTO job_boards (name, base_url, check_interval_minutes, last_checked, next_check, is_enabled, created_at)
      VALUES (?, ?, ?, NULL, datetime('now'), 1, datetime('now'))
      `,
			[name, baseUrl, checkIntervalMinutes]
		);

		return Number(result.lastInsertRowid);
	}

	/**
	 * Update job board configuration
	 */
	async updateJobBoard(id: number, config: Partial<JobBoardConfig>): Promise<void> {
		const updates: string[] = [];
		const values: any[] = [];

		if (config.name !== undefined) {
			updates.push('name = ?');
			values.push(config.name);
		}

		if (config.base_url !== undefined) {
			updates.push('base_url = ?');
			values.push(config.base_url);
		}

		if (config.check_interval_minutes !== undefined) {
			updates.push('check_interval_minutes = ?');
			values.push(config.check_interval_minutes);
		}

		if (config.is_enabled !== undefined) {
			updates.push('is_enabled = ?');
			values.push(config.is_enabled);
		}

		if (updates.length === 0) return;

		values.push(id);

		await this.db.run(`UPDATE job_boards SET ${updates.join(', ')} WHERE id = ?`, values);
	}

	/**
	 * Delete a job board configuration
	 */
	async deleteJobBoard(id: number): Promise<void> {
		await this.db.run(`DELETE FROM job_boards WHERE id = ?`, [id]);
	}

	/**
	 * Update last checked timestamp
	 */
	async updateLastChecked(id: number, lastChecked: string): Promise<void> {
		const board = await this.getJobBoard(id);
		const interval = board?.check_interval_minutes || 1440;
		const nextCheck = new Date(new Date(lastChecked).getTime() + interval * 60000).toISOString();

		await this.db.run(`UPDATE job_boards SET last_checked = ?, next_check = ? WHERE id = ?`, [
			lastChecked,
			nextCheck,
			id
		]);
	}

	/**
	 * Add job posting as application
	 */
	async addApplicationFromJob(job: JobPosting): Promise<number> {
		// Check if already exists
		const existing = await this.db.get(
			`SELECT id FROM applications WHERE job_description_url = ?`,
			[job.job_description_url]
		);

		if (existing) {
			return existing.id;
		}

		// Get backlog swimlane
		const backlog = await this.db.get(`SELECT id FROM swimlanes WHERE name = 'Backlog' LIMIT 1`);

		if (!backlog) {
			throw new Error('Default "Backlog" swimlane not found');
		}

		// Create application
		const result = await this.db.run(
			`
      INSERT INTO applications (title, company, job_description_url, job_description, status_swimlane_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `,
			[job.title, job.company, job.job_description_url, job.job_description || null, backlog.id]
		);
		const appId = Number(result.lastInsertRowid);

		// Create application fields from job data
		const fields = [
			{ name: 'job_title', value: job.title },
			{ name: 'company', value: job.company },
			{ name: 'location', value: job.location || '' },
			{ name: 'salary_range', value: job.salary_range || '' }
		];

		for (const field of fields) {
			await this.db.run(
				`
        INSERT INTO application_fields (application_id, field_name, field_value, is_required, status, created_at, updated_at)
        VALUES (?, ?, ?, 0, 'filled', datetime('now'), datetime('now'))
        ON CONFLICT(application_id, field_name) DO UPDATE SET field_value = excluded.field_value
        `,
				[appId, field.name, field.value]
			);
		}

		return appId;
	}

	/**
	 * Search job boards for postings
	 */
	async searchJobBoards(): Promise<JobPosting[]> {
		const results: JobPosting[] = [];

		// TODO: Implement actual job board scraping
		// This would use agent-browser to navigate job boards
		// and extract job postings

		return results;
	}

	/**
	 * Run scheduled searches
	 */
	async runScheduledSearches(): Promise<void> {
		const now = new Date().toISOString();

		const dueBoards = await this.db.all(
			`SELECT * FROM job_boards WHERE next_check <= ? AND is_enabled = 1`,
			[now]
		);

		for (const board of dueBoards) {
			await this.searchJobBoard(board.id);
		}
	}

	/**
	 * Search a specific job board
	 */
	async searchJobBoard(boardId: number): Promise<JobPosting[]> {
		const board = await this.getJobBoard(boardId);
		if (!board) {
			throw new Error(`Job board ${boardId} not found`);
		}

		// TODO: Implement actual search using agent-browser
		const results: JobPosting[] = [];

		// Example job postings (would be scraped from actual job board)
		// In production, this would use agent-browser to navigate and extract data

		// Update last checked timestamp
		await this.updateLastChecked(boardId, new Date().toISOString());

		return results;
	}

	/**
	 * Parse job posting from HTML
	 */
	parseJobPosting(url: string, html: string): JobPosting | null {
		// TODO: Implement HTML parsing logic
		console.log('Parsing job posting from URL (placeholder):', url, html.substring(0, 100));
		return null;
	}

	/**
	 * Validate job board URL
	 */
	isValidJobBoardUrl(url: string): boolean {
		const jobBoards = [
			'linkedin.com',
			'indeed.com',
			'glassdoor.com',
			'monster.com',
			'workday.com',
			'greenhouse.io',
			'lever.co'
		];

		return jobBoards.some((board) => url.includes(board));
	}
}
