import type { Database } from './database';

// ── Types ────────────────────────────────────────────────────────

export type ResumeFormat = 'markdown' | 'typst';

export interface AppSetting {
	key: string;
	value: string;
	updated_at: string;
}

/** Well-known setting keys and their expected value types. */
export interface AppSettingsMap {
	resume_format: ResumeFormat;

	// ── Scheduler / Automation ────────────────────────────────────
	/** Whether auto-apply is enabled (picks backlog jobs and runs pipeline). */
	auto_apply_enabled: string; // 'true' | 'false'
	/** Cron pattern for the auto-apply job (default: every 5 minutes). */
	auto_apply_cron: string;
	/** How many backlog applications to process in parallel per tick. */
	auto_apply_batch_size: string;
	/** Whether the job-board scraper schedule is enabled. */
	scraper_enabled: string; // 'true' | 'false'
	/** Cron pattern for email sync (default: every 30 minutes). */
	email_sync_cron: string;
	/** Whether audit-log cleanup is enabled. */
	audit_cleanup_enabled: string; // 'true' | 'false'
	/** Cron pattern for audit-log cleanup (default: daily at 03:00). */
	audit_cleanup_cron: string;
}

/** Default values for all well-known settings. */
const DEFAULTS: AppSettingsMap = {
	resume_format: 'markdown',

	// Scheduler defaults
	auto_apply_enabled: 'false',
	auto_apply_cron: '0 */5 * * * *',
	auto_apply_batch_size: '3',
	scraper_enabled: 'true',
	email_sync_cron: '0 */30 * * * *',
	audit_cleanup_enabled: 'false',
	audit_cleanup_cron: '0 0 3 * * *'
};

// ── Service ──────────────────────────────────────────────────────

/**
 * Simple key-value settings store backed by an `app_settings` table.
 *
 * Each setting is a single row with a unique `key`. Unknown keys are
 * allowed (stored as plain strings) but the typed helpers provide
 * compile-time safety for well-known keys like `resume_format`.
 */
export class AppSettingsService {
	private db: Database;

	constructor(db: Database) {
		this.db = db;
		this.ensureTable();
		this.seedDefaults();
	}

	// ── Schema ────────────────────────────────────────────────────

	private ensureTable(): void {
		this.db.raw.exec(`
			CREATE TABLE IF NOT EXISTS app_settings (
				key   TEXT PRIMARY KEY,
				value TEXT NOT NULL,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
			);
		`);
	}

	/**
	 * Insert default values for any well-known keys that don't yet
	 * exist in the table. Safe to call repeatedly.
	 */
	private seedDefaults(): void {
		const insert = this.db.raw.prepare(
			`INSERT OR IGNORE INTO app_settings (key, value, updated_at)
			 VALUES (?, ?, datetime('now'))`
		);

		const seed = this.db.raw.transaction(() => {
			for (const [key, value] of Object.entries(DEFAULTS)) {
				insert.run(key, String(value));
			}
		});

		seed();
	}

	// ── Typed accessors ──────────────────────────────────────────

	/**
	 * Get a well-known setting with its typed default.
	 */
	get<K extends keyof AppSettingsMap>(key: K): AppSettingsMap[K] {
		const row = this.db.get<AppSetting>('SELECT * FROM app_settings WHERE key = ?', [key]);
		return (row?.value ?? DEFAULTS[key]) as AppSettingsMap[K];
	}

	/**
	 * Set a well-known setting.
	 */
	set<K extends keyof AppSettingsMap>(key: K, value: AppSettingsMap[K]): void {
		this.db.run(
			`INSERT INTO app_settings (key, value, updated_at)
			 VALUES (?, ?, datetime('now'))
			 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
			[key, String(value)]
		);
	}

	// ── Generic accessors ────────────────────────────────────────

	/**
	 * Get any setting by key (untyped). Returns `null` if missing.
	 */
	getRaw(key: string): string | null {
		const row = this.db.get<AppSetting>('SELECT * FROM app_settings WHERE key = ?', [key]);
		return row?.value ?? null;
	}

	/**
	 * Set any setting by key (untyped).
	 */
	setRaw(key: string, value: string): void {
		this.db.run(
			`INSERT INTO app_settings (key, value, updated_at)
			 VALUES (?, ?, datetime('now'))
			 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
			[key, value]
		);
	}

	/**
	 * Delete a setting by key.
	 */
	remove(key: string): boolean {
		const result = this.db.run('DELETE FROM app_settings WHERE key = ?', [key]);
		return result.changes > 0;
	}

	/**
	 * List all settings.
	 */
	list(): AppSetting[] {
		return this.db.all<AppSetting>('SELECT * FROM app_settings ORDER BY key');
	}

	// ── Convenience ──────────────────────────────────────────────

	/** Shorthand: current resume format preference. */
	get resumeFormat(): ResumeFormat {
		return this.get('resume_format');
	}

	set resumeFormat(format: ResumeFormat) {
		this.set('resume_format', format);
	}

	// ── Scheduler convenience accessors ──────────────────────────

	/** Whether auto-apply is enabled. */
	get autoApplyEnabled(): boolean {
		return this.get('auto_apply_enabled') === 'true';
	}

	set autoApplyEnabled(enabled: boolean) {
		this.set('auto_apply_enabled', enabled ? 'true' : 'false');
	}

	/** Number of applications to process per auto-apply tick. */
	get autoApplyBatchSize(): number {
		const raw = this.get('auto_apply_batch_size');
		const n = parseInt(raw, 10);
		return Number.isFinite(n) && n > 0 ? n : 3;
	}

	set autoApplyBatchSize(size: number) {
		this.set('auto_apply_batch_size', String(Math.max(1, Math.min(10, Math.round(size)))));
	}

	/** Cron pattern for auto-apply. */
	get autoApplyCron(): string {
		return this.get('auto_apply_cron');
	}

	set autoApplyCron(cron: string) {
		this.set('auto_apply_cron', cron);
	}

	/** Whether the job-board scraper schedule is enabled. */
	get scraperEnabled(): boolean {
		return this.get('scraper_enabled') === 'true';
	}

	set scraperEnabled(enabled: boolean) {
		this.set('scraper_enabled', enabled ? 'true' : 'false');
	}

	/** Cron pattern for email sync. */
	get emailSyncCron(): string {
		return this.get('email_sync_cron');
	}

	set emailSyncCron(cron: string) {
		this.set('email_sync_cron', cron);
	}

	/** Whether audit-log cleanup is enabled. */
	get auditCleanupEnabled(): boolean {
		return this.get('audit_cleanup_enabled') === 'true';
	}

	set auditCleanupEnabled(enabled: boolean) {
		this.set('audit_cleanup_enabled', enabled ? 'true' : 'false');
	}

	/** Cron pattern for audit log cleanup. */
	get auditCleanupCron(): string {
		return this.get('audit_cleanup_cron');
	}

	set auditCleanupCron(cron: string) {
		this.set('audit_cleanup_cron', cron);
	}

	/**
	 * Get all scheduler-related settings as a typed object.
	 * Useful for the automation settings UI.
	 */
	getSchedulerSettings() {
		return {
			autoApplyEnabled: this.autoApplyEnabled,
			autoApplyCron: this.autoApplyCron,
			autoApplyBatchSize: this.autoApplyBatchSize,
			scraperEnabled: this.scraperEnabled,
			emailSyncCron: this.emailSyncCron,
			auditCleanupEnabled: this.auditCleanupEnabled,
			auditCleanupCron: this.auditCleanupCron
		};
	}
}
