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
}

/** Default values for all well-known settings. */
const DEFAULTS: AppSettingsMap = {
	resume_format: 'markdown'
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
		const row = this.db.get<AppSetting>(
			'SELECT * FROM app_settings WHERE key = ?',
			[key]
		);
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
		const row = this.db.get<AppSetting>(
			'SELECT * FROM app_settings WHERE key = ?',
			[key]
		);
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
		const result = this.db.run(
			'DELETE FROM app_settings WHERE key = ?',
			[key]
		);
		return result.changes > 0;
	}

	/**
	 * List all settings.
	 */
	list(): AppSetting[] {
		return this.db.all<AppSetting>(
			'SELECT * FROM app_settings ORDER BY key'
		);
	}

	// ── Convenience ──────────────────────────────────────────────

	/** Shorthand: current resume format preference. */
	get resumeFormat(): ResumeFormat {
		return this.get('resume_format');
	}

	set resumeFormat(format: ResumeFormat) {
		this.set('resume_format', format);
	}
}
