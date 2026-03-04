import type { Database } from './database';

// ── Types ────────────────────────────────────────────────────────────────────

export type LinkSummaryType = 'github' | 'linkedin' | 'portfolio' | 'generic';
export type LinkSummaryStatus = 'pending' | 'running' | 'done' | 'error' | 'needs_login';

export interface LinkSummary {
	id: number;
	link_title: string;
	link_url: string;
	summary: string;
	summary_type: LinkSummaryType;
	status: LinkSummaryStatus;
	error_message: string | null;
	generated_at: string | null;
	created_at: string;
	updated_at: string;
}

interface LinkSummaryRow {
	id: number;
	link_title: string;
	link_url: string;
	summary: string;
	summary_type: string;
	status: string;
	error_message: string | null;
	generated_at: string | null;
	created_at: string;
	updated_at: string;
}

export interface UpsertLinkSummaryOptions {
	link_title: string;
	link_url: string;
	summary_type: LinkSummaryType;
	/** If omitted, status defaults to 'pending' and summary to '' */
	status?: LinkSummaryStatus;
	summary?: string;
	error_message?: string | null;
	generated_at?: string | null;
}

// ── Service ──────────────────────────────────────────────────────────────────

/**
 * Manages AI-generated summaries for user profile links.
 *
 * Each summary is keyed by `link_title` (case-insensitive normalised).
 * Re-running a summarise job overwrites the previous record for that title.
 */
export class LinkSummaryService {
	private db: Database;

	constructor(db: Database) {
		this.db = db;
	}

	// ── Helpers ──────────────────────────────────────────────────────

	private normaliseTitle(title: string): string {
		return title.trim().toLowerCase();
	}

	private hydrate(row: LinkSummaryRow): LinkSummary {
		return {
			id: row.id,
			link_title: row.link_title,
			link_url: row.link_url,
			summary: row.summary,
			summary_type: row.summary_type as LinkSummaryType,
			status: row.status as LinkSummaryStatus,
			error_message: row.error_message,
			generated_at: row.generated_at,
			created_at: row.created_at,
			updated_at: row.updated_at
		};
	}

	// ── Read ─────────────────────────────────────────────────────────

	/** Return all summaries, newest first. */
	getAll(): LinkSummary[] {
		const rows = this.db.all<LinkSummaryRow>(
			`SELECT * FROM link_summaries ORDER BY updated_at DESC`
		);
		return rows.map(this.hydrate);
	}

	/** Return a single summary by link title (case-insensitive). */
	getByTitle(title: string): LinkSummary | null {
		const key = this.normaliseTitle(title);
		const row = this.db.get<LinkSummaryRow>(
			`SELECT * FROM link_summaries WHERE lower(link_title) = ?`,
			[key]
		);
		return row ? this.hydrate(row) : null;
	}

	/** Return a summary by its primary key. */
	getById(id: number): LinkSummary | null {
		const row = this.db.get<LinkSummaryRow>(`SELECT * FROM link_summaries WHERE id = ?`, [id]);
		return row ? this.hydrate(row) : null;
	}

	// ── Write ────────────────────────────────────────────────────────

	/**
	 * Insert or replace the summary record for a given link title.
	 * Keyed on `link_title` — calling this again for the same title
	 * overwrites the previous record completely.
	 */
	upsert(opts: UpsertLinkSummaryOptions): LinkSummary {
		const status: LinkSummaryStatus = opts.status ?? 'pending';
		const summary = opts.summary ?? '';
		const error_message = opts.error_message ?? null;
		const generated_at = opts.generated_at ?? null;

		this.db.run(
			`INSERT INTO link_summaries
				(link_title, link_url, summary, summary_type, status, error_message, generated_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
			 ON CONFLICT(link_title) DO UPDATE SET
				link_url        = excluded.link_url,
				summary         = excluded.summary,
				summary_type    = excluded.summary_type,
				status          = excluded.status,
				error_message   = excluded.error_message,
				generated_at    = excluded.generated_at,
				updated_at      = datetime('now')`,
			[
				opts.link_title,
				opts.link_url,
				summary,
				opts.summary_type,
				status,
				error_message,
				generated_at
			]
		);

		return this.getByTitle(opts.link_title)!;
	}

	/**
	 * Mark a summary job as running (clears any previous error).
	 */
	markRunning(title: string): void {
		this.db.run(
			`UPDATE link_summaries
			 SET status = 'running', error_message = NULL, updated_at = datetime('now')
			 WHERE lower(link_title) = ?`,
			[this.normaliseTitle(title)]
		);
	}

	/**
	 * Mark a summary as needing user login before it can proceed.
	 * Stores an optional message explaining what the user needs to do.
	 */
	markNeedsLogin(title: string, message?: string): void {
		this.db.run(
			`UPDATE link_summaries
			 SET status = 'needs_login',
			     error_message = ?,
			     updated_at = datetime('now')
			 WHERE lower(link_title) = ?`,
			[
				message ?? 'Please log in to this site in the browser, then click Retry.',
				this.normaliseTitle(title)
			]
		);
	}

	/**
	 * Persist the completed summary text and mark the record as done.
	 */
	markDone(title: string, summary: string): void {
		this.db.run(
			`UPDATE link_summaries
			 SET status       = 'done',
			     summary      = ?,
			     error_message = NULL,
			     generated_at = datetime('now'),
			     updated_at   = datetime('now')
			 WHERE lower(link_title) = ?`,
			[summary, this.normaliseTitle(title)]
		);
	}

	/**
	 * Persist an error and mark the record as failed.
	 */
	markError(title: string, errorMessage: string): void {
		this.db.run(
			`UPDATE link_summaries
			 SET status = 'error', error_message = ?, updated_at = datetime('now')
			 WHERE lower(link_title) = ?`,
			[errorMessage, this.normaliseTitle(title)]
		);
	}

	/**
	 * Delete the summary record for a given title.
	 * Used when the parent link is deleted.
	 */
	deleteByTitle(title: string): void {
		this.db.run(`DELETE FROM link_summaries WHERE lower(link_title) = ?`, [
			this.normaliseTitle(title)
		]);
	}

	/**
	 * Reset a summary back to 'pending' so it can be re-queued.
	 */
	resetToPending(title: string): void {
		this.db.run(
			`UPDATE link_summaries
			 SET status = 'pending', error_message = NULL, updated_at = datetime('now')
			 WHERE lower(link_title) = ?`,
			[this.normaliseTitle(title)]
		);
	}
}
