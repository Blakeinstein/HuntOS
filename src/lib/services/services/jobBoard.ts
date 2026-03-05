import type { Database } from './database';

export interface JobBoardConfig {
	id: number;
	name: string;
	base_url: string;
	check_interval_minutes: number;
	last_checked?: string;
	next_check?: string;
	is_enabled: boolean;
	max_listings_per_scrape: number;
	last_scraped_page?: number;
	last_scraped_page_url?: string;
	last_page_scraped_at?: string;
	page_retention_days: number;
	created_at: string;
}

/**
 * Pagination state resolved for a scrape session.
 *
 * The scraper service calls `resolvePaginationState()` to get this before
 * each scrape. If the last-page bookmark has expired (older than
 * `page_retention_days`), the state resets so the scrape starts from the
 * beginning.
 */
export interface PaginationState {
	/** The page number to resume from (1-based), or `null` to start fresh. */
	resumePage: number | null;
	/** The URL of the last scraped page, or `null` when starting fresh. */
	resumePageUrl: string | null;
	/** Maximum number of job listings to collect in this scrape session. */
	maxListings: number;
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
	location?: string | null;
	job_type?: 'remote' | 'hybrid' | 'on-site' | 'unknown' | null;
	salary_range?: string | null;
	description?: string | null;
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
		maxListingsPerScrape?: number;
		pageRetentionDays?: number;
		searchQueries?: string[];
	}): Promise<number> {
		const {
			name,
			baseUrl,
			checkIntervalMinutes = 1440,
			maxListingsPerScrape = 25,
			pageRetentionDays = 3
		} = config;

		const result = await this.db.run(
			`
      INSERT INTO job_boards (name, base_url, check_interval_minutes, max_listings_per_scrape, page_retention_days, last_checked, next_check, is_enabled, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, datetime('now'), 1, datetime('now'))
      `,
			[name, baseUrl, checkIntervalMinutes, maxListingsPerScrape, pageRetentionDays]
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

		if (config.max_listings_per_scrape !== undefined) {
			updates.push('max_listings_per_scrape = ?');
			values.push(config.max_listings_per_scrape);
		}

		if (config.page_retention_days !== undefined) {
			updates.push('page_retention_days = ?');
			values.push(config.page_retention_days);
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
	 * Update the pagination bookmark after a successful scrape.
	 *
	 * @param id        - The job board ID.
	 * @param page      - The 1-based page number that was last scraped.
	 * @param pageUrl   - The full URL of that page (with any pagination query params).
	 */
	async updatePaginationState(id: number, page: number, pageUrl: string): Promise<void> {
		await this.db.run(
			`UPDATE job_boards SET last_scraped_page = ?, last_scraped_page_url = ?, last_page_scraped_at = datetime('now') WHERE id = ?`,
			[page, pageUrl, id]
		);
	}

	/**
	 * Clear the pagination bookmark so the next scrape starts from page 1.
	 */
	async resetPaginationState(id: number): Promise<void> {
		await this.db.run(
			`UPDATE job_boards SET last_scraped_page = NULL, last_scraped_page_url = NULL, last_page_scraped_at = NULL WHERE id = ?`,
			[id]
		);
	}

	/**
	 * Proactively clear expired pagination bookmarks across all job boards.
	 *
	 * Each board's `page_retention_days` defines the maximum age of its
	 * `last_page_scraped_at` timestamp. Any board whose bookmark is older
	 * than that window is reset so the next scrape starts from page 1.
	 *
	 * This runs in a single UPDATE rather than per-board, so it is safe
	 * to call on every scheduler tick without noticeable overhead.
	 *
	 * @returns The number of boards whose bookmarks were cleared.
	 */
	async cleanupExpiredPaginationBookmarks(): Promise<number> {
		const result = await this.db.run(
			`UPDATE job_boards
			 SET last_scraped_page = NULL,
			     last_scraped_page_url = NULL,
			     last_page_scraped_at = NULL
			 WHERE last_page_scraped_at IS NOT NULL
			   AND (
			     julianday('now') - julianday(last_page_scraped_at)
			   ) > page_retention_days`
		);
		return result.changes ?? 0;
	}

	/**
	 * Resolve the pagination state for a scrape session.
	 *
	 * If the last-page bookmark exists but is older than the configured
	 * `page_retention_days`, it is treated as expired and the scrape
	 * will start from the beginning.
	 */
	async resolvePaginationState(id: number): Promise<PaginationState> {
		const board = await this.getJobBoard(id);
		if (!board) {
			return { resumePage: null, resumePageUrl: null, maxListings: 25 };
		}

		const maxListings = board.max_listings_per_scrape;

		// No bookmark at all — start fresh
		if (!board.last_scraped_page || !board.last_page_scraped_at) {
			return { resumePage: null, resumePageUrl: null, maxListings };
		}

		// Check retention expiry
		const scrapedAt = new Date(board.last_page_scraped_at).getTime();
		const retentionMs = board.page_retention_days * 24 * 60 * 60 * 1000;
		const isExpired = Date.now() - scrapedAt > retentionMs;

		if (isExpired) {
			// Clear stale bookmark so subsequent reads also see a clean state
			await this.resetPaginationState(id);
			return { resumePage: null, resumePageUrl: null, maxListings };
		}

		return {
			resumePage: board.last_scraped_page,
			resumePageUrl: board.last_scraped_page_url ?? null,
			maxListings
		};
	}

	/**
	 * Add a scraped job posting as an application in the Backlog swimlane.
	 *
	 * This only persists the listing details gathered during scraping.
	 * No form fields are generated — form fields are only relevant when
	 * actually applying for a job, which is a separate concern.
	 *
	 * @returns `{ id, isNew }` — `isNew` is `true` when a new row was inserted,
	 *          `false` when the URL already existed (duplicate).
	 */
	async addApplicationFromJob(job: JobPosting): Promise<{ id: number; isNew: boolean }> {
		// Check if already exists (deduplicate by URL)
		const existing = await this.db.get<{ id: number }>(
			`SELECT id FROM applications WHERE job_description_url = ?`,
			[job.job_description_url]
		);

		if (existing) {
			return { id: existing.id, isNew: false };
		}

		// Get backlog swimlane
		const backlog = await this.db.get(`SELECT id FROM swimlanes WHERE name = 'Backlog' LIMIT 1`);

		if (!backlog) {
			throw new Error('Default "Backlog" swimlane not found');
		}

		// Build a structured job description from scraped details
		const descriptionParts: string[] = [];
		if (job.location) descriptionParts.push(`Location: ${job.location}`);
		if (job.job_type && job.job_type !== 'unknown') descriptionParts.push(`Type: ${job.job_type}`);
		if (job.salary_range) descriptionParts.push(`Salary: ${job.salary_range}`);
		if (job.description) descriptionParts.push(`\n${job.description}`);

		const fullDescription =
			descriptionParts.length > 0 ? descriptionParts.join('\n') : job.job_description || null;

		// Create application — store all listing details directly on the record
		const result = await this.db.run(
			`
      INSERT INTO applications (title, company, job_description_url, job_description, status_swimlane_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `,
			[job.title, job.company, job.job_description_url, fullDescription, backlog.id]
		);

		return { id: Number(result.lastInsertRowid), isNew: true };
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
		console.log(
			'[JobBoard] Parsing job posting from URL (placeholder):',
			url,
			html.substring(0, 100)
		);
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
