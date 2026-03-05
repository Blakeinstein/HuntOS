import type { Database } from './database';

// ── Types ───────────────────────────────────────────────────────────

export type PipelineStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
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

export interface PipelineStepLog {
	id: number;
	pipeline_run_id: number;
	step: PipelineStep;
	level: PipelineLogLevel;
	message: string;
	meta: Record<string, unknown> | null;
	created_at: string;
}

export type PipelineLogLevel = 'info' | 'warn' | 'error' | 'progress';

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

interface PipelineStepLogRow {
	id: number;
	pipeline_run_id: number;
	step: string;
	level: string;
	message: string;
	meta: string | null;
	created_at: string;
}

// ── Service ─────────────────────────────────────────────────────────

/**
 * Manages the state of multi-step apply pipeline runs and their step logs.
 *
 * Each pipeline run tracks:
 * - Which step is currently executing
 * - Which steps have been completed
 * - Whether the run succeeded, failed, or was cancelled
 * - Error messages for failed runs
 * - Granular progress logs within each step
 *
 * This is a pure state-tracking service — the actual step execution
 * logic lives in the ApplyPipelineExecutor.
 */
export class ApplicationPipelineService {
	private db: Database;

	constructor(db: Database) {
		this.db = db;
	}

	// ── Write ───────────────────────────────────────────────────────

	/**
	 * Create a new pipeline run for an application.
	 * Sets the status to 'running' and begins at the research step.
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

	/**
	 * Cancel a running pipeline. Sets status to 'cancelled'.
	 * The executor must check isCancelled() to actually stop work.
	 */
	cancel(runId: number): boolean {
		const run = this.getById(runId);
		if (!run) return false;

		// Only cancel if still running or pending
		if (run.status !== 'running' && run.status !== 'pending') {
			return false;
		}

		this.db.run(
			`UPDATE application_pipeline_runs
			 SET status = 'cancelled', error_message = 'Cancelled by user', completed_at = datetime('now')
			 WHERE id = ?`,
			[runId]
		);

		this.addStepLog(runId, run.current_step ?? 'research', 'warn', 'Pipeline cancelled by user');

		return true;
	}

	/**
	 * Check if a pipeline run has been cancelled.
	 * The executor calls this at checkpoints to cooperatively stop.
	 */
	isCancelled(runId: number): boolean {
		const row = this.db.get<{ status: string }>(
			'SELECT status FROM application_pipeline_runs WHERE id = ?',
			[runId]
		);
		return row?.status === 'cancelled';
	}

	// ── Step Logs ───────────────────────────────────────────────────

	/**
	 * Add a progress log entry for a specific step within a pipeline run.
	 */
	addStepLog(
		runId: number,
		step: PipelineStep,
		level: PipelineLogLevel,
		message: string,
		meta?: Record<string, unknown>
	): void {
		this.db.run(
			`INSERT INTO pipeline_step_logs
				(pipeline_run_id, step, level, message, meta, created_at)
			 VALUES (?, ?, ?, ?, ?, datetime('now'))`,
			[runId, step, level, message, meta ? JSON.stringify(meta) : null]
		);
	}

	/**
	 * Get all step logs for a pipeline run, ordered chronologically.
	 */
	getStepLogs(runId: number): PipelineStepLog[] {
		const rows = this.db.all<PipelineStepLogRow>(
			`SELECT * FROM pipeline_step_logs
			 WHERE pipeline_run_id = ?
			 ORDER BY created_at ASC, id ASC`,
			[runId]
		);
		return rows.map((row) => this.hydrateLog(row));
	}

	/**
	 * Get step logs filtered by step name.
	 */
	getStepLogsByStep(runId: number, step: PipelineStep): PipelineStepLog[] {
		const rows = this.db.all<PipelineStepLogRow>(
			`SELECT * FROM pipeline_step_logs
			 WHERE pipeline_run_id = ? AND step = ?
			 ORDER BY created_at ASC, id ASC`,
			[runId, step]
		);
		return rows.map((row) => this.hydrateLog(row));
	}

	/**
	 * Get step logs created after a given log ID (for incremental polling).
	 */
	getStepLogsSince(runId: number, afterLogId: number): PipelineStepLog[] {
		const rows = this.db.all<PipelineStepLogRow>(
			`SELECT * FROM pipeline_step_logs
			 WHERE pipeline_run_id = ? AND id > ?
			 ORDER BY created_at ASC, id ASC`,
			[runId, afterLogId]
		);
		return rows.map((row) => this.hydrateLog(row));
	}

	/**
	 * Delete all step logs for a pipeline run.
	 */
	deleteStepLogs(runId: number): number {
		const result = this.db.run('DELETE FROM pipeline_step_logs WHERE pipeline_run_id = ?', [runId]);
		return result.changes;
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
			 WHERE application_id = ? AND status IN ('running', 'pending')`,
			[applicationId]
		);
		return (row?.count ?? 0) > 0;
	}

	/**
	 * Get the single active pipeline run across ALL applications (if any).
	 *
	 * Because the browser agent is a shared singleton, only one application
	 * can be processed at a time. This method is used by the scheduler and
	 * the apply API to enforce that constraint.
	 */
	getGlobalActiveRun(): PipelineRun | null {
		const row = this.db.get<PipelineRunRow>(
			`SELECT * FROM application_pipeline_runs
			 WHERE status IN ('running', 'pending')
			 ORDER BY created_at DESC
			 LIMIT 1`
		);
		return row ? this.hydrate(row) : null;
	}

	// ── Delete ──────────────────────────────────────────────────────

	/**
	 * Delete a pipeline run by ID (also deletes its step logs).
	 */
	delete(id: number): boolean {
		this.deleteStepLogs(id);
		const result = this.db.run('DELETE FROM application_pipeline_runs WHERE id = ?', [id]);
		return result.changes > 0;
	}

	/**
	 * Delete all pipeline runs for an application (also deletes step logs).
	 */
	deleteByApplicationId(applicationId: number): number {
		// Get all run IDs first to clean up step logs
		const runs = this.getByApplicationId(applicationId);
		for (const run of runs) {
			this.deleteStepLogs(run.id);
		}

		const result = this.db.run('DELETE FROM application_pipeline_runs WHERE application_id = ?', [
			applicationId
		]);
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

	/**
	 * Parse a raw step log row into a typed `PipelineStepLog`.
	 */
	private hydrateLog(row: PipelineStepLogRow): PipelineStepLog {
		let meta: Record<string, unknown> | null = null;
		if (row.meta) {
			try {
				meta = JSON.parse(row.meta);
			} catch {
				meta = null;
			}
		}

		return {
			id: row.id,
			pipeline_run_id: row.pipeline_run_id,
			step: row.step as PipelineStep,
			level: row.level as PipelineLogLevel,
			message: row.message,
			meta,
			created_at: row.created_at
		};
	}
}
