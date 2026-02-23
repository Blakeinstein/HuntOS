import type { Database } from './database';

// ── Types ───────────────────────────────────────────────────────────

export type PipelineStatus = 'pending' | 'running' | 'completed' | 'failed';
export type PipelineStep = 'research' | 'resume' | 'apply';

export const PIPELINE_STEPS: PipelineStep[] = ['research', 'resume', 'apply'];

export const PIPELINE_STEP_LABELS: Record<PipelineStep, string> = {
	research: 'Research & Job Details',
	resume: 'Generate Resume',
	apply: 'Apply to Job'
};

export interface PipelineRun {
	id: number;
	application_id: number;
	status: PipelineStatus;
	current_step: PipelineStep | null;
	steps_completed: PipelineStep[];
	error_message: string | null;
	started_at: string | null;
	completed_at: string | null;
	created_at: string;
}

interface PipelineRunRow {
	id: number;
	application_id: number;
	status: string;
	current_step: string | null;
	steps_completed: string;
	error_message: string | null;
	started_at: string | null;
	completed_at: string | null;
	created_at: string;
}

// ── Service ─────────────────────────────────────────────────────────

/**
 * Manages the state of multi-step apply pipeline runs.
 *
 * Each pipeline run tracks:
 * - Which step is currently executing
 * - Which steps have been completed
 * - Whether the run succeeded or failed
 * - Error messages for failed runs
 *
 * This is a pure state-tracking service — the actual step execution
 * logic lives in the API route handler and the individual services
 * it orchestrates.
 */
export class ApplicationPipelineService {
	private db: Database;

	constructor(db: Database) {
		this.db = db;
	}

	// ── Write ───────────────────────────────────────────────────────

	/**
	 * Create a new pipeline run for an application.
	 * Sets the status to 'pending' — call `startStep()` to begin execution.
	 *
	 * @returns The created pipeline run.
	 */
	create(applicationId: number): PipelineRun {
		const result = this.db.run(
			`INSERT INTO application_pipeline_runs
				(application_id, status, current_step, steps_completed, started_at)
			 VALUES (?, 'running', 'research', '[]', datetime('now'))`,
			[applicationId]
		);
		const id = Number(result.lastInsertRowid);
		return this.getById(id)!;
	}

	/**
	 * Mark a step as the current active step.
	 */
	startStep(runId: number, step: PipelineStep): void {
		this.db.run(
			`UPDATE application_pipeline_runs
			 SET current_step = ?, status = 'running'
			 WHERE id = ?`,
			[step, runId]
		);
	}

	/**
	 * Mark the current step as completed and add it to the completed list.
	 */
	completeStep(runId: number, step: PipelineStep): void {
		const run = this.getById(runId);
		if (!run) return;

		const completed = [...run.steps_completed];
		if (!completed.includes(step)) {
			completed.push(step);
		}

		this.db.run(
			`UPDATE application_pipeline_runs
			 SET steps_completed = ?, current_step = NULL
			 WHERE id = ?`,
			[JSON.stringify(completed), runId]
		);
	}

	/**
	 * Mark the entire pipeline run as successfully completed.
	 */
	complete(runId: number): void {
		this.db.run(
			`UPDATE application_pipeline_runs
			 SET status = 'completed', completed_at = datetime('now'), current_step = NULL
			 WHERE id = ?`,
			[runId]
		);
	}

	/**
	 * Mark the pipeline run as failed with an error message.
	 */
	fail(runId: number, errorMessage: string): void {
		this.db.run(
			`UPDATE application_pipeline_runs
			 SET status = 'failed', error_message = ?, completed_at = datetime('now')
			 WHERE id = ?`,
			[errorMessage, runId]
		);
	}

	// ── Read ────────────────────────────────────────────────────────

	/**
	 * Get a single pipeline run by ID.
	 */
	getById(id: number): PipelineRun | null {
		const row = this.db.get<PipelineRunRow>(
			'SELECT * FROM application_pipeline_runs WHERE id = ?',
			[id]
		);
		return row ? this.hydrate(row) : null;
	}

	/**
	 * Get all pipeline runs for an application, newest first.
	 */
	getByApplicationId(applicationId: number): PipelineRun[] {
		const rows = this.db.all<PipelineRunRow>(
			`SELECT * FROM application_pipeline_runs
			 WHERE application_id = ?
			 ORDER BY created_at DESC`,
			[applicationId]
		);
		return rows.map((row) => this.hydrate(row));
	}

	/**
	 * Get the latest pipeline run for an application.
	 */
	getLatestByApplicationId(applicationId: number): PipelineRun | null {
		const row = this.db.get<PipelineRunRow>(
			`SELECT * FROM application_pipeline_runs
			 WHERE application_id = ?
			 ORDER BY created_at DESC
			 LIMIT 1`,
			[applicationId]
		);
		return row ? this.hydrate(row) : null;
	}

	/**
	 * Check if an application has an active (running) pipeline.
	 */
	hasActiveRun(applicationId: number): boolean {
		const row = this.db.get<{ count: number }>(
			`SELECT COUNT(*) as count FROM application_pipeline_runs
			 WHERE application_id = ? AND status = 'running'`,
			[applicationId]
		);
		return (row?.count ?? 0) > 0;
	}

	// ── Delete ──────────────────────────────────────────────────────

	/**
	 * Delete a pipeline run by ID.
	 */
	delete(id: number): boolean {
		const result = this.db.run('DELETE FROM application_pipeline_runs WHERE id = ?', [id]);
		return result.changes > 0;
	}

	/**
	 * Delete all pipeline runs for an application.
	 */
	deleteByApplicationId(applicationId: number): number {
		const result = this.db.run(
			'DELETE FROM application_pipeline_runs WHERE application_id = ?',
			[applicationId]
		);
		return result.changes;
	}

	// ── Helpers ─────────────────────────────────────────────────────

	/**
	 * Parse the raw SQLite row into a typed `PipelineRun`.
	 */
	private hydrate(row: PipelineRunRow): PipelineRun {
		let stepsCompleted: PipelineStep[] = [];
		if (row.steps_completed) {
			try {
				stepsCompleted = JSON.parse(row.steps_completed);
			} catch {
				stepsCompleted = [];
			}
		}

		return {
			id: row.id,
			application_id: row.application_id,
			status: row.status as PipelineStatus,
			current_step: row.current_step as PipelineStep | null,
			steps_completed: stepsCompleted,
			error_message: row.error_message,
			started_at: row.started_at,
			completed_at: row.completed_at,
			created_at: row.created_at
		};
	}
}
