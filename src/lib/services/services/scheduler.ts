// src/lib/services/services/scheduler.ts
// Cronbake-based scheduler service for running periodic background jobs.
//
// Jobs:
//   - scrape-job-boards   — checks due boards every 5 min (per-board intervals on Job Boards page)
//   - sync-emails         — syncs email accounts for status updates (cron from settings)
//   - audit-cleanup       — removes audit logs older than retention period (cron from settings)
//   - auto-apply          — picks N backlog applications and runs apply pipeline (cron from settings)
//
// The scraper uses a fixed internal cron tick; each board's own check_interval_minutes
// and next_check timestamp determine when it is actually scraped.
// Call `reconfigure()` after changing settings to update cron patterns without restart.
//
// Persistence: file-based at data/cronbake-state.json so job state survives restarts.
// Logging: tagged [scheduler] lines written to stdout via schedulerLogger; captured
//          by the dev server tee into data/logs/dev.log and filterable in the admin panel.
// Audit: each job run creates audit log entries for observability.

import Baker, { FilePersistenceProvider } from 'cronbake';
import { resolve } from 'path';
import { mkdirSync } from 'fs';
import { schedulerLogger } from './schedulerLogger';
import type { AuditLogService } from './auditLog';
import type { EmailMonitorService } from './emailMonitor';
import type { JobBoardService } from './jobBoard';
import type { JobBoardScraperService } from './jobBoardScraper';
import type { AppSettingsService } from './appSettings';
import type { ApplicationService } from './application';
import type { ApplyPipelineExecutor } from './applyPipelineExecutor';
import type { ApplicationPipelineService } from './applicationPipeline';

// ── Types ───────────────────────────────────────────────────────────

export interface SchedulerDeps {
	auditLogService: AuditLogService;
	emailMonitorService: EmailMonitorService;
	jobBoardService: JobBoardService;
	appSettingsService: AppSettingsService;
	applicationService: ApplicationService;
	applicationPipelineService: ApplicationPipelineService;
	/** Nullable because it's wired after Mastra init via withMastra() */
	getJobBoardScraperService: () => JobBoardScraperService | null;
	/** Nullable because it's wired after Mastra init via withMastra() */
	getApplyPipelineExecutor: () => ApplyPipelineExecutor | null;
}

export interface SchedulerJobStatus {
	name: string;
	status: string;
	lastExecution: Date | null;
	nextExecution: Date | null;
	metrics: {
		totalExecutions: number;
		successfulExecutions: number;
		failedExecutions: number;
		averageExecutionTime: number;
	} | null;
}

/** Cron configuration snapshot — used to detect when reconfiguration is needed. */
interface CronSnapshot {
	scraperEnabled: boolean;
	auditCleanupEnabled: boolean;
	auditCleanupCron: string;
	autoApplyEnabled: boolean;
	autoApplyCron: string;
}

/**
 * Fixed internal cron for the scraper tick.
 * Runs every 5 minutes to check if any boards are due based on their
 * individual `next_check` timestamps. This is NOT user-configurable —
 * per-board intervals are set on the Job Boards settings page.
 */
const SCRAPER_INTERNAL_CRON = '0 */5 * * * *';

// ── Constants ───────────────────────────────────────────────────────

const STATE_PATH = resolve('data/cronbake-state.json');
const DEFAULT_RETENTION_DAYS = 90;

// Job name constants
const JOB_SCRAPE = 'scrape-job-boards';
const JOB_EMAIL_SYNC = 'sync-emails';
const JOB_AUDIT_CLEANUP = 'audit-cleanup';
const JOB_AUTO_APPLY = 'auto-apply';

// Ensure data/ directory exists for persistence file
mkdirSync(resolve('data'), { recursive: true });

// ── Scheduler Service ───────────────────────────────────────────────

export class SchedulerService {
	private baker: InstanceType<typeof Baker> | null = null;
	private deps: SchedulerDeps;
	private initialized = false;
	/** Track current cron config so reconfigure() can detect changes. */
	private currentCrons: CronSnapshot | null = null;

	constructor(deps: SchedulerDeps) {
		this.deps = deps;
	}

	// ── Helpers ──────────────────────────────────────────────────────

	/** Read the current cron configuration from app settings. */
	private readCronSnapshot(): CronSnapshot {
		const { appSettingsService } = this.deps;
		return {
			scraperEnabled: appSettingsService.scraperEnabled,
			auditCleanupEnabled: appSettingsService.auditCleanupEnabled,
			auditCleanupCron: appSettingsService.auditCleanupCron,
			autoApplyEnabled: appSettingsService.autoApplyEnabled,
			autoApplyCron: appSettingsService.autoApplyCron
		};
	}

	/**
	 * Initialize the baker instance and register all jobs.
	 * Must be called once before start(). Awaits persistence restore.
	 */
	async init(): Promise<void> {
		if (this.initialized) return;

		schedulerLogger.info('Initializing scheduler...');

		this.baker = Baker.create({
			autoStart: false,
			enableMetrics: true,
			logger: schedulerLogger,
			schedulerConfig: {
				useCalculatedTimeouts: true,
				maxHistoryEntries: 50
			},
			persistence: {
				enabled: true,
				strategy: 'file',
				provider: new FilePersistenceProvider(STATE_PATH),
				autoRestore: true
			},
			onError: (error: Error, jobName?: string) => {
				schedulerLogger.error(`Job "${jobName ?? 'unknown'}" error: ${error.message}`);
			}
		});

		await this.baker.ready();

		this.registerJobs();
		this.initialized = true;

		schedulerLogger.info('Scheduler initialized with jobs:', this.getJobNames().join(', '));
	}

	// ── Job Registration ────────────────────────────────────────────

	private registerJobs(): void {
		if (!this.baker) return;

		const snapshot = this.readCronSnapshot();
		// NOTE: currentCrons is set at the END of this method, derived from
		// actual live baker state, so reconfigure() diffs against reality.

		// Cronbake is the single source of truth for job state.
		// After baker.ready() the persistence file has already been restored —
		// any job that was saved (with its status, cron, metrics, history) is
		// already live in the baker.  We only bootstrap a job here when it is
		// NOT present in the baker yet (i.e. first run, or it was intentionally
		// removed from the state file via the admin Cronbake editor).
		//
		// Callbacks are always wired regardless of source so that restored jobs
		// have a real handler instead of the no-op stub cronbake inserts.

		const has = (name: string) => this.getJobNames().includes(name);

		// ── scrape-job-boards ────────────────────────────────────────────────
		// Bootstrap only when absent AND the setting says it should be enabled.
		if (!has(JOB_SCRAPE)) {
			if (snapshot.scraperEnabled) {
				this.registerScraperJob(SCRAPER_INTERNAL_CRON);
				schedulerLogger.info(`[init] Bootstrapped ${JOB_SCRAPE} (not in state file)`);
			}
		} else {
			// Job was restored from file — just wire the real callback.
			this.wireCallback(JOB_SCRAPE, () => this.runScrapeJobBoards(), JOB_SCRAPE);
		}

		// ── sync-emails ──────────────────────────────────────────────────────
		// TODO: Email sync is not yet fully implemented. The job is intentionally
		// never bootstrapped. If a stale entry exists in the cronbake state file,
		// remove it — we do NOT wire a callback so it stays inert.

		// ── audit-cleanup ────────────────────────────────────────────────────
		if (!has(JOB_AUDIT_CLEANUP)) {
			if (snapshot.auditCleanupEnabled) {
				this.registerAuditCleanupJob(snapshot.auditCleanupCron);
				schedulerLogger.info(`[init] Bootstrapped ${JOB_AUDIT_CLEANUP} (not in state file)`);
			}
		} else {
			this.wireCallback(JOB_AUDIT_CLEANUP, () => this.runAuditCleanup(), JOB_AUDIT_CLEANUP);
		}

		// ── auto-apply ───────────────────────────────────────────────────────
		if (!has(JOB_AUTO_APPLY)) {
			if (snapshot.autoApplyEnabled) {
				this.registerAutoApplyJob(snapshot.autoApplyCron);
				schedulerLogger.info(`[init] Bootstrapped ${JOB_AUTO_APPLY} (not in state file)`);
			}
		} else {
			this.wireCallback(JOB_AUTO_APPLY, () => this.runAutoApply(), JOB_AUTO_APPLY);
		}

		// Derive currentCrons from what actually ended up live in the baker.
		// For jobs restored from the file, use the cron stored in the file
		// rather than the appSettings value — the file is the source of truth.
		// If a stale sync-emails entry survived in the state file, evict it now
		// so it doesn't linger as an inert restored job with a no-op callback.
		if (this.baker.getJobNames().includes(JOB_EMAIL_SYNC)) {
			try {
				this.baker.stop(JOB_EMAIL_SYNC);
				this.baker.remove(JOB_EMAIL_SYNC);
				schedulerLogger.info(`[init] Removed stale ${JOB_EMAIL_SYNC} entry from state file`);
			} catch {
				// ignore
			}
		}

		const liveJobs = this.baker.getAllJobs();
		this.currentCrons = {
			scraperEnabled: liveJobs.has(JOB_SCRAPE),
			auditCleanupEnabled: liveJobs.has(JOB_AUDIT_CLEANUP),
			auditCleanupCron: liveJobs.get(JOB_AUDIT_CLEANUP)?.cron ?? snapshot.auditCleanupCron,
			autoApplyEnabled: liveJobs.has(JOB_AUTO_APPLY),
			autoApplyCron: liveJobs.get(JOB_AUTO_APPLY)?.cron ?? snapshot.autoApplyCron
		};

		schedulerLogger.info(
			`[init] currentCrons derived from live state — ` +
				`scraper:${this.currentCrons.scraperEnabled} ` +
				`auditCleanup:${this.currentCrons.auditCleanupEnabled} ` +
				`autoApply:${this.currentCrons.autoApplyEnabled}`
		);
	}

	/**
	 * Wire a real callback onto an already-restored cronbake job.
	 * Cronbake's restore stub emits a warning log when the job fires without
	 * a real handler, so we replace it by removing + re-adding the job while
	 * preserving the cron expression it was restored with.
	 */
	private wireCallback(name: string, callback: () => void, logTag: string): void {
		if (!this.baker) return;
		try {
			// Grab the cron expression and running status before we remove the job.
			const allJobs = this.baker.getAllJobs();
			const restoredJob = allJobs.get(name);
			const restoredCron: string = restoredJob?.cron ?? '';

			if (!restoredCron) {
				schedulerLogger.warn(`[init] wireCallback: could not find cron for restored job "${name}"`);
				return;
			}

			// Preserve whether the job was running so we can restart it after re-add.
			const wasRunning = this.baker.getStatus(name) === 'running';

			// remove() destroys the no-op-callback job and clears it from restoredJobs.
			this.baker.remove(name);

			this.baker.add({
				name,
				cron: restoredCron,
				persist: true,
				overrunProtection: true,
				callback,
				onTick: () => schedulerLogger.info(`[${logTag}] Tick — starting execution`),
				onComplete: () => schedulerLogger.info(`[${logTag}] Execution complete`),
				onError: (error: Error) => schedulerLogger.error(`[${logTag}] Failed: ${error.message}`)
			});

			// Re-start if it was running before we swapped the callback.
			if (wasRunning) {
				this.baker.bake(name);
			}

			schedulerLogger.info(
				`[init] Wired real callback onto restored job "${name}" (cron: ${restoredCron}, running: ${wasRunning})`
			);
		} catch (err) {
			schedulerLogger.warn(
				`[init] wireCallback failed for "${name}": ${err instanceof Error ? err.message : String(err)}`
			);
		}
	}

	/** Register or re-register the scraper job. Uses fixed internal cron. */
	private registerScraperJob(cron: string = SCRAPER_INTERNAL_CRON): void {
		if (!this.baker) return;

		this.baker.add({
			name: JOB_SCRAPE,
			cron,
			persist: true,
			overrunProtection: true,
			callback: () => this.runScrapeJobBoards(),
			onTick: () => {
				schedulerLogger.info(`[${JOB_SCRAPE}] Tick — starting execution`);
			},
			onComplete: () => {
				schedulerLogger.info(`[${JOB_SCRAPE}] Execution complete`);
			},
			onError: (error: Error) => {
				schedulerLogger.error(`[${JOB_SCRAPE}] Failed: ${error.message}`);
			}
		});
	}

	/** Register or re-register the audit cleanup job with the given cron. */
	private registerAuditCleanupJob(cron: string): void {
		if (!this.baker) return;

		this.baker.add({
			name: JOB_AUDIT_CLEANUP,
			cron,
			persist: true,
			overrunProtection: true,
			callback: () => this.runAuditCleanup(),
			onTick: () => {
				schedulerLogger.info(`[${JOB_AUDIT_CLEANUP}] Tick — starting execution`);
			},
			onComplete: () => {
				schedulerLogger.info(`[${JOB_AUDIT_CLEANUP}] Execution complete`);
			},
			onError: (error: Error) => {
				schedulerLogger.error(`[${JOB_AUDIT_CLEANUP}] Failed: ${error.message}`);
			}
		});
	}

	/** Register or re-register the auto-apply job with the given cron. */
	private registerAutoApplyJob(cron: string): void {
		if (!this.baker) return;

		this.baker.add({
			name: JOB_AUTO_APPLY,
			cron,
			persist: true,
			overrunProtection: true,
			callback: () => this.runAutoApply(),
			onTick: () => {
				schedulerLogger.info(`[${JOB_AUTO_APPLY}] Tick — starting execution`);
			},
			onComplete: () => {
				schedulerLogger.info(`[${JOB_AUTO_APPLY}] Execution complete`);
			},
			onError: (error: Error) => {
				schedulerLogger.error(`[${JOB_AUTO_APPLY}] Failed: ${error.message}`);
			}
		});
	}

	// ── Dynamic Reconfiguration ─────────────────────────────────────

	/**
	 * Re-read settings and update cron patterns for any jobs whose
	 * schedules have changed. Call this after the user saves automation
	 * settings in the UI.
	 *
	 * This destroys and re-adds jobs whose cron has changed, which
	 * effectively reschedules them. Running jobs are left alone until
	 * their current execution completes.
	 */
	async reconfigure(): Promise<{ changed: string[] }> {
		if (!this.baker || !this.initialized) {
			return { changed: [] };
		}

		const newSnapshot = this.readCronSnapshot();
		const old = this.currentCrons;
		const changed: string[] = [];

		if (!old) {
			this.currentCrons = newSnapshot;
			await this.baker.saveState();
			return { changed: [] };
		}

		// Helper: remove + re-add a job with a new cron
		const updateJobCron = (name: string, newCron: string) => {
			try {
				this.baker!.stop(name);
				this.baker!.remove(name);
			} catch {
				// Job might not exist yet
			}

			// Re-register based on job name
			switch (name) {
				case JOB_AUDIT_CLEANUP:
					this.registerAuditCleanupJob(newCron);
					break;
				case JOB_AUTO_APPLY:
					this.registerAutoApplyJob(newCron);
					break;
			}

			this.baker!.bake(name);
			changed.push(name);
			schedulerLogger.info(`[reconfigure] Updated cron for "${name}" → ${newCron}`);
		};

		/** Helper: handle enable/disable + cron change for a toggleable job. */
		const handleToggleableJob = (
			jobName: string,
			wasEnabled: boolean,
			isEnabled: boolean,
			oldCron: string,
			newCron: string,
			registerFn: (cron: string) => void,
			label: string
		) => {
			if (isEnabled && !wasEnabled) {
				// Newly enabled — register and start
				registerFn(newCron);
				this.baker!.bake(jobName);
				changed.push(jobName);
				schedulerLogger.info(`[reconfigure] Enabled ${label} with cron: ${newCron}`);
			} else if (!isEnabled && wasEnabled) {
				// Disabled — stop and remove
				try {
					this.baker!.stop(jobName);
					this.baker!.remove(jobName);
				} catch {
					// May not exist
				}
				changed.push(jobName);
				schedulerLogger.info(`[reconfigure] Disabled ${label}`);
			} else if (isEnabled && newCron !== oldCron) {
				// Cron changed while enabled
				updateJobCron(jobName, newCron);
			}
		};

		// Handle scraper enable/disable (no user-configurable cron — fixed internal tick)
		if (newSnapshot.scraperEnabled && !old.scraperEnabled) {
			this.registerScraperJob();
			this.baker!.bake(JOB_SCRAPE);
			changed.push(JOB_SCRAPE);
			schedulerLogger.info(`[reconfigure] Enabled scraper (fixed tick: ${SCRAPER_INTERNAL_CRON})`);
		} else if (!newSnapshot.scraperEnabled && old.scraperEnabled) {
			try {
				this.baker!.stop(JOB_SCRAPE);
				this.baker!.remove(JOB_SCRAPE);
			} catch {
				// May not exist
			}
			changed.push(JOB_SCRAPE);
			schedulerLogger.info('[reconfigure] Disabled scraper');
		}

		// sync-emails is not yet implemented — skipped in reconfigure()

		// Handle audit cleanup enable/disable + cron change
		handleToggleableJob(
			JOB_AUDIT_CLEANUP,
			old.auditCleanupEnabled,
			newSnapshot.auditCleanupEnabled,
			old.auditCleanupCron,
			newSnapshot.auditCleanupCron,
			(cron) => this.registerAuditCleanupJob(cron),
			'audit-cleanup'
		);

		// Handle auto-apply enable/disable + cron change
		handleToggleableJob(
			JOB_AUTO_APPLY,
			old.autoApplyEnabled,
			newSnapshot.autoApplyEnabled,
			old.autoApplyCron,
			newSnapshot.autoApplyCron,
			(cron) => this.registerAutoApplyJob(cron),
			'auto-apply'
		);

		this.currentCrons = newSnapshot;

		// Always persist after reconfigure so the file stays in sync with the
		// live baker state (enable/disable + cron changes are reflected on disk).
		await this.baker.saveState();

		if (changed.length > 0) {
			schedulerLogger.info(`[reconfigure] Updated ${changed.length} job(s): ${changed.join(', ')}`);
		} else {
			schedulerLogger.info('[reconfigure] No changes detected');
		}

		return { changed };
	}

	// ── Job Implementations ─────────────────────────────────────────

	/**
	 * Scrape job boards that are due based on their individual `next_check` timestamps.
	 * This runs on a fixed internal cron (every 5 min) and only scrapes boards whose
	 * `next_check` has elapsed, respecting per-board check intervals.
	 */
	private async runScrapeJobBoards(): Promise<void> {
		const { auditLogService, jobBoardService, getJobBoardScraperService } = this.deps;

		const finish = auditLogService.start({
			category: 'scheduler',
			agent_id: 'scheduler.scrape-job-boards',
			title: 'Scheduled job board scrape'
		});

		try {
			const scraperService = getJobBoardScraperService();
			if (!scraperService) {
				schedulerLogger.warn(
					`[${JOB_SCRAPE}] Scraper service not available (Mastra not wired yet)`
				);
				finish({
					status: 'warning',
					detail: 'Scraper service not initialized — skipped'
				});
				return;
			}

			// Proactively clear any pagination bookmarks that have exceeded their
			// board-specific retention window. This ensures boards are reset to
			// page 1 on schedule even if no scrape fired during the window.
			const expired = await jobBoardService.cleanupExpiredPaginationBookmarks();
			if (expired > 0) {
				schedulerLogger.info(`[${JOB_SCRAPE}] Cleared ${expired} expired pagination bookmark(s)`);
			}

			// Only fetch boards that are due (next_check <= now and enabled)
			const now = new Date().toISOString();
			const allBoards = await jobBoardService.getJobBoards();
			const dueBoards = allBoards.filter(
				(b) => b.is_enabled && (!b.next_check || b.next_check <= now)
			);

			if (dueBoards.length === 0) {
				schedulerLogger.debug(`[${JOB_SCRAPE}] No boards due for scraping — skipping`);
				finish({ status: 'info', detail: 'No boards due for scraping' });
				return;
			}

			schedulerLogger.info(`[${JOB_SCRAPE}] ${dueBoards.length} board(s) due for scraping`);

			let scraped = 0;
			let errors = 0;

			for (const board of dueBoards) {
				try {
					schedulerLogger.info(`[${JOB_SCRAPE}] Scraping: ${board.name} (id=${board.id})`);

					await scraperService.scrape({
						jobBoardId: board.id
					});

					scraped++;
					schedulerLogger.info(`[${JOB_SCRAPE}] Completed: ${board.name}`);
				} catch (err) {
					errors++;
					const detail = err instanceof Error ? err.message : String(err);
					schedulerLogger.error(`[${JOB_SCRAPE}] Failed to scrape ${board.name}: ${detail}`);
				}
			}

			finish({
				status: errors === 0 ? 'success' : 'warning',
				detail: `Scraped ${scraped}/${dueBoards.length} due boards (${errors} errors)`,
				meta: { scraped, errors, total: dueBoards.length }
			});
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			schedulerLogger.error(`[${JOB_SCRAPE}] Fatal error: ${detail}`);
			finish({ status: 'error', detail });
			throw err;
		}
	}

	private async runSyncEmails(): Promise<void> {
		const { auditLogService, emailMonitorService } = this.deps;

		const finish = auditLogService.start({
			category: 'scheduler',
			agent_id: 'scheduler.sync-emails',
			title: 'Scheduled email sync'
		});

		try {
			const accounts = await emailMonitorService.getEmailAccounts();

			if (accounts.length === 0) {
				schedulerLogger.info(`[${JOB_EMAIL_SYNC}] No email accounts configured — skipping`);
				finish({ status: 'info', detail: 'No email accounts configured' });
				return;
			}

			schedulerLogger.info(`[${JOB_EMAIL_SYNC}] Syncing ${accounts.length} email account(s)`);

			let totalMessages = 0;
			let errors = 0;

			for (const account of accounts) {
				try {
					schedulerLogger.info(
						`[${JOB_EMAIL_SYNC}] Syncing account: ${account.username} (${account.provider})`
					);

					const messages = await emailMonitorService.syncEmails(account.id);
					totalMessages += messages.length;

					if (messages.length > 0) {
						schedulerLogger.info(
							`[${JOB_EMAIL_SYNC}] Account ${account.username}: ${messages.length} message(s)`
						);
					}
				} catch (err) {
					errors++;
					const detail = err instanceof Error ? err.message : String(err);
					schedulerLogger.error(
						`[${JOB_EMAIL_SYNC}] Failed to sync ${account.username}: ${detail}`
					);
				}
			}

			finish({
				status: errors === 0 ? 'success' : 'warning',
				detail: `Synced ${accounts.length} accounts: ${totalMessages} messages (${errors} errors)`,
				meta: { accounts: accounts.length, totalMessages, errors }
			});
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			schedulerLogger.error(`[${JOB_EMAIL_SYNC}] Fatal error: ${detail}`);
			finish({ status: 'error', detail });
			throw err;
		}
	}

	private async runAuditCleanup(): Promise<void> {
		const { auditLogService } = this.deps;
		const retentionDays = DEFAULT_RETENTION_DAYS;

		const finish = auditLogService.start({
			category: 'scheduler',
			agent_id: 'scheduler.audit-cleanup',
			title: 'Scheduled audit log cleanup'
		});

		try {
			const cutoff = new Date();
			cutoff.setDate(cutoff.getDate() - retentionDays);
			const cutoffIso = cutoff.toISOString();

			schedulerLogger.info(
				`[${JOB_AUDIT_CLEANUP}] Removing entries older than ${retentionDays} days (before ${cutoffIso})`
			);

			const deleted = auditLogService.deleteOlderThan(cutoffIso);

			schedulerLogger.info(`[${JOB_AUDIT_CLEANUP}] Removed ${deleted} entries`);

			if (deleted > 0) {
				finish({
					status: 'success',
					detail: `Removed ${deleted} entries older than ${retentionDays} days`,
					meta: { deleted, retentionDays, cutoffDate: cutoffIso }
				});
			} else {
				finish({
					status: 'info',
					detail: `No entries older than ${retentionDays} days to remove`
				});
			}
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			schedulerLogger.error(`[${JOB_AUDIT_CLEANUP}] Fatal error: ${detail}`);
			finish({ status: 'error', detail });
			throw err;
		}
	}

	/**
	 * Auto-apply: pick the oldest application from the Backlog swimlane and
	 * run the full apply pipeline on it.
	 *
	 * Only one application is processed at a time because the browser agent
	 * is a shared singleton. If any pipeline is already running (from a
	 * previous tick or a manual trigger) this tick is skipped entirely.
	 */
	private async runAutoApply(): Promise<void> {
		const {
			auditLogService,
			appSettingsService,
			applicationService,
			applicationPipelineService,
			getApplyPipelineExecutor
		} = this.deps;

		const finish = auditLogService.start({
			category: 'scheduler',
			agent_id: 'scheduler.auto-apply',
			title: 'Scheduled auto-apply (1 at a time)'
		});

		try {
			// Double-check that auto-apply is still enabled (in case settings
			// changed between the cron tick and actual execution)
			if (!appSettingsService.autoApplyEnabled) {
				schedulerLogger.info(`[${JOB_AUTO_APPLY}] Auto-apply is disabled — skipping`);
				finish({ status: 'info', detail: 'Auto-apply disabled in settings' });
				return;
			}

			const executor = getApplyPipelineExecutor();
			if (!executor) {
				schedulerLogger.warn(
					`[${JOB_AUTO_APPLY}] Pipeline executor not available (Mastra not wired yet)`
				);
				finish({
					status: 'warning',
					detail: 'Pipeline executor not initialized — skipped'
				});
				return;
			}

			// Skip this tick entirely if any pipeline is already running globally.
			// The browser agent is a shared singleton — running two pipelines in
			// parallel would cause them to interfere with each other.
			const globalActiveRun = applicationPipelineService.getGlobalActiveRun();
			if (globalActiveRun) {
				schedulerLogger.info(
					`[${JOB_AUTO_APPLY}] A pipeline is already running (app=${globalActiveRun.application_id}, run=${globalActiveRun.id}) — skipping this tick`
				);
				finish({
					status: 'info',
					detail: `Pipeline already running for application ${globalActiveRun.application_id} — skipped`
				});
				return;
			}

			// Get all backlog applications (sorted by created_at ASC — oldest first)
			const allApps = await applicationService.getApplications();
			const backlogApps = allApps
				.filter((app) => app.swimlane_name.toLowerCase() === 'backlog')
				.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

			if (backlogApps.length === 0) {
				schedulerLogger.info(`[${JOB_AUTO_APPLY}] No applications in Backlog — skipping`);
				finish({ status: 'info', detail: 'No applications in Backlog' });
				return;
			}

			// Pick the oldest backlog application
			const app = backlogApps[0];
			const appLabel = `${app.company} — ${app.title} (id=${app.id})`;

			schedulerLogger.info(
				`[${JOB_AUTO_APPLY}] Starting pipeline for: ${appLabel} (${backlogApps.length} remaining in Backlog)`
			);

			const result = await executor.execute(app.id);

			if (result.success) {
				schedulerLogger.info(
					`[${JOB_AUTO_APPLY}] ✓ Pipeline succeeded for: ${appLabel} (runId=${result.pipelineRunId})`
				);
			} else {
				schedulerLogger.warn(
					`[${JOB_AUTO_APPLY}] ✗ Pipeline failed for: ${appLabel} — ${result.error}`
				);
			}

			finish({
				status: result.success ? 'success' : 'warning',
				detail: result.success
					? `Pipeline completed for ${app.company} — ${app.title}`
					: `Pipeline failed for ${app.company} — ${app.title}: ${result.error}`,
				meta: {
					applicationId: app.id,
					pipelineRunId: result.pipelineRunId,
					backlogRemaining: backlogApps.length - 1,
					success: result.success,
					error: result.error ?? null
				}
			});
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			schedulerLogger.error(`[${JOB_AUTO_APPLY}] Fatal error: ${detail}`);
			finish({ status: 'error', detail });
			throw err;
		}
	}

	// ── Control ─────────────────────────────────────────────────────

	/** Start all cron jobs. */
	async start(): Promise<void> {
		if (!this.baker) {
			await this.init();
		}
		schedulerLogger.info('Starting all scheduler jobs...');
		this.baker!.bakeAll();
		await this.baker!.saveState();
		schedulerLogger.info('All scheduler jobs started');
	}

	/** Stop all cron jobs. */
	async stop(): Promise<void> {
		if (!this.baker) return;
		schedulerLogger.info('Stopping all scheduler jobs...');
		this.baker.stopAll();
		await this.baker.saveState();
		schedulerLogger.info('All scheduler jobs stopped');
	}

	/** Pause a specific job by name. */
	async pauseJob(name: string): Promise<void> {
		if (!this.baker) return;
		schedulerLogger.info(`Pausing job: ${name}`);
		this.baker.pause(name);
		await this.baker.saveState();
	}

	/** Resume a specific job by name. */
	async resumeJob(name: string): Promise<void> {
		if (!this.baker) return;
		schedulerLogger.info(`Resuming job: ${name}`);
		this.baker.resume(name);
		await this.baker.saveState();
	}

	/** Start a specific job by name. */
	async startJob(name: string): Promise<void> {
		if (!this.baker) return;
		schedulerLogger.info(`Starting job: ${name}`);
		this.baker.bake(name);
		await this.baker.saveState();
	}

	/** Stop a specific job by name. */
	async stopJob(name: string): Promise<void> {
		if (!this.baker) return;
		schedulerLogger.info(`Stopping job: ${name}`);
		this.baker.stop(name);
		await this.baker.saveState();
	}

	/** Trigger a specific job immediately (one-off execution). */
	async triggerJob(name: string): Promise<void> {
		schedulerLogger.info(`Manually triggering job: ${name}`);

		switch (name) {
			case JOB_SCRAPE:
				await this.runScrapeJobBoards();
				break;
			case JOB_EMAIL_SYNC:
				await this.runSyncEmails();
				break;
			case JOB_AUDIT_CLEANUP:
				await this.runAuditCleanup();
				break;
			case JOB_AUTO_APPLY:
				await this.runAutoApply();
				break;
			default:
				throw new Error(`Unknown job: ${name}`);
		}
	}

	// ── Status / Introspection ──────────────────────────────────────

	/** Get names of all registered jobs. */
	getJobNames(): string[] {
		if (!this.baker) return [];
		return this.baker.getJobNames();
	}

	/** Get status details for a single job. */
	getJobStatus(name: string): SchedulerJobStatus | null {
		if (!this.baker) return null;

		try {
			const status = this.baker.getStatus(name);
			const lastExec = this.baker.lastExecution(name);
			const nextExec = this.baker.nextExecution(name);

			let metrics: SchedulerJobStatus['metrics'] = null;
			try {
				const m = this.baker.getMetrics(name);
				if (m) {
					metrics = {
						totalExecutions: m.totalExecutions ?? 0,
						successfulExecutions: m.successfulExecutions ?? 0,
						failedExecutions: m.failedExecutions ?? 0,
						averageExecutionTime: m.averageExecutionTime ?? 0
					};
				}
			} catch {
				// Metrics may not be available
			}

			return {
				name,
				status: status ?? 'unknown',
				lastExecution: lastExec ?? null,
				nextExecution: nextExec ?? null,
				metrics
			};
		} catch {
			return null;
		}
	}

	/** Get status for all registered jobs. */
	getAllJobStatuses(): SchedulerJobStatus[] {
		return this.getJobNames()
			.map((name) => this.getJobStatus(name))
			.filter((s): s is SchedulerJobStatus => s !== null);
	}

	/** Whether the scheduler has been initialized. */
	isInitialized(): boolean {
		return this.initialized;
	}

	/** Get the current cron snapshot (for the settings UI). */
	getCurrentCrons(): CronSnapshot | null {
		return this.currentCrons;
	}

	/** Destroy the baker and clean up. */
	async destroy(): Promise<void> {
		if (!this.baker) return;
		schedulerLogger.info('Destroying scheduler...');
		this.baker.destroyAll();
		this.baker = null;
		this.initialized = false;
		schedulerLogger.info('Scheduler destroyed');
	}
}
