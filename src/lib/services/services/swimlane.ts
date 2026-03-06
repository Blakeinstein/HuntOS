import type { Database } from './database';
import { nowIso } from '$lib/services/helpers/nowIso';
import type { Application } from './application';

/** Swimlane names that cannot be deleted by the user. */
export const NON_REMOVABLE_SWIMLANES = [
	'Backlog',
	'In Progress',
	'Action Required',
	'Applied',
	'Rejected'
] as const;
export type NonRemovableSwimlane = (typeof NON_REMOVABLE_SWIMLANES)[number];

/**
 * The canonical display order for the built-in swimlanes.
 * Custom swimlanes are appended after these in creation order.
 */
export const CANONICAL_SWIMLANE_ORDER: NonRemovableSwimlane[] = [
	'Backlog',
	'In Progress',
	'Action Required',
	'Applied',
	'Rejected'
];

export interface Swimlane {
	id: number;
	name: string;
	description?: string;
	is_custom: boolean;
	order_index: number;
	created_at: string;
}

export interface SwimlaneApplication extends Application {
	swimlane_name: string;
}

export class SwimlaneService {
	private db: Database;

	constructor(db: Database) {
		this.db = db;
	}

	/**
	 * Get all swimlanes
	 */
	async getSwimlanes(): Promise<Swimlane[]> {
		return this.db.all(`SELECT * FROM swimlanes ORDER BY order_index ASC, created_at ASC`);
	}

	/**
	 * Get a single swimlane by ID
	 */
	async getSwimlane(id: number): Promise<Swimlane | null> {
		return this.db.get(`SELECT * FROM swimlanes WHERE id = ?`, [id]);
	}

	/**
	 * Get applications in a specific swimlane
	 */
	async getSwimlaneApplications(swimlaneId: number): Promise<SwimlaneApplication[]> {
		return this.db.all(
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
        s.name as swimlane_name
      FROM applications a
      JOIN swimlanes s ON a.status_swimlane_id = s.id
      WHERE a.status_swimlane_id = ?
      ORDER BY a.created_at DESC
    `,
			[swimlaneId]
		) as SwimlaneApplication[];
	}

	/**
	 * Create a new swimlane
	 */
	async createSwimlane(name: string, description?: string): Promise<number> {
		const maxOrder = await this.db.get(`SELECT MAX(order_index) as max FROM swimlanes`);
		const orderIndex = (maxOrder?.max || 0) + 1;

		const result = await this.db.run(
			`INSERT INTO swimlanes (name, description, is_custom, order_index, created_at) VALUES (?, ?, 1, ?, ?)`,
			[name, description || null, orderIndex, nowIso()]
		);

		return Number(result.lastInsertRowid);
	}

	/**
	 * Update a swimlane
	 */
	async updateSwimlane(
		id: number,
		data: Partial<Pick<Swimlane, 'name' | 'description'>>
	): Promise<void> {
		const updates: string[] = [];
		const values: any[] = [];

		if (data.name !== undefined) {
			updates.push('name = ?');
			values.push(data.name);
		}

		if (data.description !== undefined) {
			updates.push('description = ?');
			values.push(data.description);
		}

		if (updates.length === 0) return;

		values.push(id);

		await this.db.run(`UPDATE swimlanes SET ${updates.join(', ')} WHERE id = ?`, values);
	}

	/**
	 * Delete a swimlane
	 */
	async deleteSwimlane(id: number): Promise<void> {
		const swimlane = await this.getSwimlane(id);
		if (!swimlane) {
			throw new Error(`Swimlane ${id} not found`);
		}

		if (!swimlane.is_custom) {
			throw new Error('Cannot delete default swimlane');
		}

		if (NON_REMOVABLE_SWIMLANES.includes(swimlane.name as NonRemovableSwimlane)) {
			throw new Error(`Cannot delete the "${swimlane.name}" swimlane`);
		}

		// Reorder remaining swimlanes
		await this.db.run(
			`UPDATE swimlanes SET order_index = order_index - 1 WHERE order_index > (SELECT order_index FROM swimlanes WHERE id = ?)`,
			[id]
		);

		await this.db.run(`DELETE FROM swimlanes WHERE id = ?`, [id]);
	}

	/**
	 * Reorder swimlanes by accepting a full ordered list of IDs.
	 * Each ID is assigned an order_index matching its position in the array.
	 * IDs not present in the array are left unchanged.
	 */
	async reorderSwimlanes(orderedIds: number[]): Promise<void> {
		for (let i = 0; i < orderedIds.length; i++) {
			await this.db.run(`UPDATE swimlanes SET order_index = ? WHERE id = ?`, [i, orderedIds[i]]);
		}
	}

	/**
	 * Initialize default swimlanes if they don't exist
	 */
	async initializeDefaultSwimlanes(): Promise<void> {
		const existing = await this.db.all(`SELECT COUNT(*) as count FROM swimlanes`);

		if (existing[0]?.count && existing[0].count > 0) {
			// Run migrations for databases created before certain swimlanes were added,
			// then normalise the order of built-in swimlanes to the canonical sequence.
			await this.ensureInProgressSwimlane();
			await this.normaliseCanonicalOrder();
			return;
		}

		const defaultSwimlanes: { name: NonRemovableSwimlane; description: string }[] = [
			{ name: 'Backlog', description: 'Applications waiting to be processed' },
			{
				name: 'In Progress',
				description: 'Applications currently being processed by the pipeline'
			},
			{ name: 'Action Required', description: 'Applications needing user input' },
			{ name: 'Applied', description: 'Applications that have been submitted' },
			{ name: 'Rejected', description: 'Applications that were rejected' }
		];

		for (let i = 0; i < defaultSwimlanes.length; i++) {
			const swimlane = defaultSwimlanes[i];
			await this.db.run(
				`INSERT INTO swimlanes (name, description, is_custom, order_index, created_at) VALUES (?, ?, 0, ?, ?)`,
				[swimlane.name, swimlane.description, i, nowIso()]
			);
		}
	}

	/**
	 * Ensure the "In Progress" swimlane exists — migration for databases
	 * created before this swimlane was introduced.
	 */
	async ensureInProgressSwimlane(): Promise<void> {
		const existing = await this.db.get(
			`SELECT id FROM swimlanes WHERE name = 'In Progress' LIMIT 1`
		);
		if (existing) return;

		// Temporarily place it at a high order index; normaliseCanonicalOrder will fix positioning.
		const maxOrder = await this.db.get<{ max: number }>(
			`SELECT MAX(order_index) as max FROM swimlanes`
		);
		const order = (maxOrder?.max ?? 0) + 1;
		await this.db.run(
			`INSERT INTO swimlanes (name, description, is_custom, order_index, created_at) VALUES ('In Progress', 'Applications currently being processed by the pipeline', 0, ?, ?)`,
			[order, nowIso()]
		);
	}

	/**
	 * Reorder the built-in swimlanes to match CANONICAL_SWIMLANE_ORDER while
	 * preserving the relative order of any custom swimlanes (appended at the end).
	 *
	 * This is idempotent — safe to call on every startup.
	 */
	async normaliseCanonicalOrder(): Promise<void> {
		const all = await this.getSwimlanes();

		const builtIn = CANONICAL_SWIMLANE_ORDER.map((name) => all.find((s) => s.name === name)).filter(
			(s): s is Swimlane => s !== undefined
		);

		const custom = all.filter(
			(s) => !CANONICAL_SWIMLANE_ORDER.includes(s.name as NonRemovableSwimlane)
		);

		const ordered = [...builtIn, ...custom];

		for (let i = 0; i < ordered.length; i++) {
			if (ordered[i].order_index !== i) {
				await this.db.run(`UPDATE swimlanes SET order_index = ? WHERE id = ?`, [i, ordered[i].id]);
			}
		}
	}
}
