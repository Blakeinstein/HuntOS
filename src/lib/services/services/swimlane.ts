import type { Database } from './database';
import type { Application } from './application';

/** Swimlane names that cannot be deleted by the user. */
export const NON_REMOVABLE_SWIMLANES = [
	'Backlog',
	'Applied',
	'Rejected',
	'Action Required',
	'In Progress'
] as const;
export type NonRemovableSwimlane = (typeof NON_REMOVABLE_SWIMLANES)[number];

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
			`INSERT INTO swimlanes (name, description, is_custom, order_index, created_at) VALUES (?, ?, 1, ?, datetime('now'))`,
			[name, description || null, orderIndex]
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
	 * Move swimlane up or down in order
	 */
	async reorderSwimlane(id: number, direction: 'up' | 'down'): Promise<void> {
		const swimlanes = await this.getSwimlanes();
		const currentIndex = swimlanes.findIndex((s) => s.id === id);

		if (direction === 'up' && currentIndex > 0) {
			const targetId = swimlanes[currentIndex - 1].id;
			const currentOrder = swimlanes[currentIndex].order_index;
			const targetOrder = swimlanes[currentIndex - 1].order_index;

			await this.db.run(
				`
        UPDATE swimlanes SET order_index = ? WHERE id = ?;
        UPDATE swimlanes SET order_index = ? WHERE id = ?
      `,
				[targetOrder, id, currentOrder, targetId]
			);
		} else if (direction === 'down' && currentIndex < swimlanes.length - 1) {
			const targetId = swimlanes[currentIndex + 1].id;
			const currentOrder = swimlanes[currentIndex].order_index;
			const targetOrder = swimlanes[currentIndex + 1].order_index;

			await this.db.run(
				`
        UPDATE swimlanes SET order_index = ? WHERE id = ?;
        UPDATE swimlanes SET order_index = ? WHERE id = ?
      `,
				[targetOrder, id, currentOrder, targetId]
			);
		}
	}

	/**
	 * Initialize default swimlanes if they don't exist
	 */
	async initializeDefaultSwimlanes(): Promise<void> {
		const existing = await this.db.all(`SELECT COUNT(*) as count FROM swimlanes`);

		if (existing[0]?.count && existing[0].count > 0) {
			// Ensure the "In Progress" swimlane exists for databases created before it was added.
			await this.ensureInProgressSwimlane();
			return;
		}

		const defaultSwimlanes = [
			{ name: 'Backlog', description: 'Applications waiting to be processed', order: 0 },
			{
				name: 'In Progress',
				description: 'Applications currently being processed by the pipeline',
				order: 1
			},
			{ name: 'Applied', description: 'Applications that have been submitted', order: 2 },
			{ name: 'Rejected', description: 'Applications that were rejected', order: 3 },
			{ name: 'Action Required', description: 'Applications needing user input', order: 4 }
		];

		for (const swimlane of defaultSwimlanes) {
			await this.db.run(
				`INSERT INTO swimlanes (name, description, is_custom, order_index, created_at) VALUES (?, ?, 0, ?, datetime('now'))`,
				[swimlane.name, swimlane.description || null, swimlane.order]
			);
		}
	}

	/**
	 * Ensure the "In Progress" swimlane exists — used as a migration for
	 * existing databases that were created before this swimlane was added.
	 */
	async ensureInProgressSwimlane(): Promise<void> {
		const existing = await this.db.get(
			`SELECT id FROM swimlanes WHERE name = 'In Progress' LIMIT 1`
		);
		if (existing) return;

		// Insert between Backlog (order 0) and Applied, shifting everything else up.
		await this.db.run(`UPDATE swimlanes SET order_index = order_index + 1 WHERE order_index >= 1`);
		await this.db.run(
			`INSERT INTO swimlanes (name, description, is_custom, order_index, created_at) VALUES ('In Progress', 'Applications currently being processed by the pipeline', 0, 1, datetime('now'))`
		);
	}
}
