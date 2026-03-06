import type { Database } from './database';
import { nowIso } from '$lib/services/helpers/nowIso';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * A resume template stored in the database.
 */
export interface ResumeTemplate {
	id: number;
	name: string;
	/** Handlebars-flavoured Markdown content */
	content: string;
	/** Whether this is the built-in default (non-deletable) */
	is_default: number;
	created_at: string;
	updated_at: string;
}

/**
 * Payload for creating or updating a template.
 */
export interface UpsertTemplateInput {
	name: string;
	content: string;
}

/**
 * Service responsible for CRUD operations on resume Handlebars templates.
 *
 * On first access it seeds the database with the built-in default template
 * shipped in `src/lib/services/resume/defaultTemplate.md`.
 */
export class ResumeTemplateService {
	private db: Database;
	private seeded = false;

	constructor(db: Database) {
		this.db = db;
		this.ensureTable();
	}

	// ── Schema ────────────────────────────────────────────────────

	private ensureTable(): void {
		this.db.raw.exec(`
			CREATE TABLE IF NOT EXISTS resume_templates (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL UNIQUE,
				content TEXT NOT NULL,
				is_default BOOLEAN NOT NULL DEFAULT 0,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
			);
		`);
	}

	// ── Seeding ───────────────────────────────────────────────────

	/**
	 * Ensures the built-in "Default" template exists.
	 * Safe to call multiple times — it only runs once per process.
	 */
	seed(): void {
		if (this.seeded) return;

		const existing = this.db.get<ResumeTemplate>(
			`SELECT * FROM resume_templates WHERE is_default = 1 LIMIT 1`
		);

		if (!existing) {
			const defaultContent = this.loadDefaultTemplateFromDisk();
			const now = nowIso();
			this.db.run(
				`INSERT INTO resume_templates (name, content, is_default, created_at, updated_at)
				 VALUES (?, ?, 1, ?, ?)`,
				['Default', defaultContent, now, now]
			);
		}

		this.seeded = true;
	}

	private loadDefaultTemplateFromDisk(): string {
		// Works for both dev (src/) and built (build/) paths.
		const candidates = [
			path.resolve(process.cwd(), 'src/lib/services/resume/defaultTemplate.md'),
			path.resolve(__dirname, '../resume/defaultTemplate.md')
		];

		for (const p of candidates) {
			try {
				return fs.readFileSync(p, 'utf8');
			} catch {
				// try next
			}
		}

		// Fallback: a minimal template so the system never hard-crashes.
		return `# {{name}}\n\n{{professional_profile}}\n\n## Skills\n{{#each skills}}\n- {{this}}\n{{/each}}`;
	}

	// ── Queries ───────────────────────────────────────────────────

	/**
	 * List every template, default first, then alphabetical.
	 */
	list(): ResumeTemplate[] {
		this.seed();
		return this.db.all<ResumeTemplate>(
			`SELECT * FROM resume_templates ORDER BY is_default DESC, name ASC`
		);
	}

	/**
	 * Get a template by id. Returns `null` if not found.
	 */
	getById(id: number): ResumeTemplate | null {
		this.seed();
		return this.db.get<ResumeTemplate>(`SELECT * FROM resume_templates WHERE id = ?`, [id]) ?? null;
	}

	/**
	 * Get the default template. Always returns a template after seeding.
	 */
	getDefault(): ResumeTemplate {
		this.seed();
		const tpl = this.db.get<ResumeTemplate>(
			`SELECT * FROM resume_templates WHERE is_default = 1 LIMIT 1`
		);
		// Should never be null after seed(), but guard anyway.
		if (!tpl) {
			throw new Error('Default resume template missing — database may be corrupt');
		}
		return tpl;
	}

	// ── Mutations ─────────────────────────────────────────────────

	/**
	 * Create a new user template.
	 * The `is_default` flag is always false for user-created templates.
	 */
	create(input: UpsertTemplateInput): ResumeTemplate {
		const now = nowIso();
		const result = this.db.run(
			`INSERT INTO resume_templates (name, content, is_default, created_at, updated_at)
			 VALUES (?, ?, 0, ?, ?)`,
			[input.name.trim(), input.content, now, now]
		);

		const id = Number(result.lastInsertRowid);
		const created = this.getById(id);
		if (!created) throw new Error('Failed to retrieve newly created template');
		return created;
	}

	/**
	 * Update an existing template's name and/or content.
	 * The built-in default template's content can be updated but it
	 * cannot be renamed or deleted.
	 */
	update(id: number, input: Partial<UpsertTemplateInput>): ResumeTemplate {
		const existing = this.getById(id);
		if (!existing) throw new Error(`Template ${id} not found`);

		const newName = existing.is_default ? existing.name : (input.name?.trim() ?? existing.name);
		const newContent = input.content ?? existing.content;

		this.db.run(`UPDATE resume_templates SET name = ?, content = ?, updated_at = ? WHERE id = ?`, [
			newName,
			newContent,
			nowIso(),
			id
		]);

		return this.getById(id)!;
	}

	/**
	 * Delete a user template. Cannot delete the default template.
	 */
	remove(id: number): void {
		const existing = this.getById(id);
		if (!existing) throw new Error(`Template ${id} not found`);
		if (existing.is_default) throw new Error('Cannot delete the default template');

		this.db.run(`DELETE FROM resume_templates WHERE id = ?`, [id]);
	}

	/**
	 * Reset the default template back to the on-disk version.
	 */
	resetDefault(): ResumeTemplate {
		const defaultTpl = this.getDefault();
		const freshContent = this.loadDefaultTemplateFromDisk();

		this.db.run(`UPDATE resume_templates SET content = ?, updated_at = ? WHERE id = ?`, [
			freshContent,
			nowIso(),
			defaultTpl.id
		]);

		return this.getById(defaultTpl.id)!;
	}
}
