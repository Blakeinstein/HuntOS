// src/lib/services/services/linkSummaryQueue.ts
// A lightweight, in-process async job queue for link summarisation tasks.
//
// Design notes:
//   - Jobs are queued in memory and processed one at a time (serial) to avoid
//     hammering external sites with concurrent headless browser instances.
//   - A job is identified by its link title (case-insensitive). If the same
//     title is queued while already pending/running, it is de-duplicated.
//   - The queue is fire-and-forget from the HTTP request's perspective; callers
//     enqueue a job and receive an immediate acknowledgement while the actual
//     scraping happens in the background.
//   - Audit events are emitted for every state transition via AuditLogService.
//   - After a successful scrape the summary text is embedded into the
//     link_summary_vec vector table via LinkSummaryVectorService so the
//     resume agent can do semantic search across all profile link summaries.

import type { AuditLogService } from './auditLog';
import type { LinkSummaryService } from './linkSummary';
import type { ProfileService } from './profile';
import type { LinkSummaryVectorService } from './linkSummaryVector';
import { scrapeLinkAndSummarise } from './linkScraper';

// ── Types ────────────────────────────────────────────────────────────────────

export interface LinkSummaryJob {
	title: string;
	url: string;
	/** ISO timestamp of when the job was enqueued. */
	enqueuedAt: string;
}

export type QueueStatus = 'idle' | 'running';

export interface QueueState {
	status: QueueStatus;
	pending: LinkSummaryJob[];
	currentJob: LinkSummaryJob | null;
}

// ── Service ──────────────────────────────────────────────────────────────────

/**
 * LinkSummaryQueue manages a serial async queue of link-scraping jobs.
 *
 * Usage:
 * ```ts
 * const queue = new LinkSummaryQueue(auditLogService, linkSummaryService, profileService);
 * queue.enqueue({ title: 'GitHub', url: 'https://github.com/yourname' });
 * ```
 */
export class LinkSummaryQueue {
	private auditLogService: AuditLogService;
	private linkSummaryService: LinkSummaryService;
	private profileService: ProfileService;
	private linkSummaryVectorService: LinkSummaryVectorService | null = null;

	private pending: LinkSummaryJob[] = [];
	private currentJob: LinkSummaryJob | null = null;
	private isRunning = false;

	constructor(
		auditLogService: AuditLogService,
		linkSummaryService: LinkSummaryService,
		profileService: ProfileService
	) {
		this.auditLogService = auditLogService;
		this.linkSummaryService = linkSummaryService;
		this.profileService = profileService;
	}

	/**
	 * Wire the vector service after it has been constructed.
	 * Called from the service container once both services are available.
	 */
	setLinkSummaryVectorService(service: LinkSummaryVectorService): void {
		this.linkSummaryVectorService = service;
	}

	// ── Public API ───────────────────────────────────────────────────

	/**
	 * Add a link-scraping job to the queue.
	 *
	 * If a job for the same title is already pending or currently running,
	 * this is a no-op (de-duplication).
	 *
	 * @returns `true` if the job was newly enqueued, `false` if it was a duplicate.
	 */
	enqueue(job: Omit<LinkSummaryJob, 'enqueuedAt'>): boolean {
		const key = job.title.trim().toLowerCase();

		// De-duplicate: check current job and pending queue
		if (this.currentJob && this.currentJob.title.toLowerCase() === key) {
			return false;
		}
		if (this.pending.some((j) => j.title.toLowerCase() === key)) {
			return false;
		}

		const fullJob: LinkSummaryJob = {
			...job,
			enqueuedAt: new Date().toISOString()
		};

		// Ensure a pending record exists in the DB immediately so the UI can
		// show the "pending" state before the job actually starts.
		this.linkSummaryService.upsert({
			link_title: job.title,
			link_url: job.url,
			summary_type: this.detectType(job.title, job.url),
			status: 'pending'
		});

		this.auditLogService.create({
			category: 'profile',
			agent_id: 'link-summariser',
			status: 'info',
			title: `Link summary queued: "${job.title}"`,
			detail: `URL: ${job.url}`,
			meta: { link_title: job.title, url: job.url, queue_position: this.pending.length + 1 }
		});

		this.pending.push(fullJob);
		this.drain();
		return true;
	}

	/**
	 * Current snapshot of the queue state. Safe to call at any time.
	 */
	getState(): QueueState {
		return {
			status: this.isRunning ? 'running' : 'idle',
			pending: [...this.pending],
			currentJob: this.currentJob ? { ...this.currentJob } : null
		};
	}

	/**
	 * How many jobs are waiting (not counting the currently running job).
	 */
	get pendingCount(): number {
		return this.pending.length;
	}

	/**
	 * Whether the queue is currently executing a job.
	 */
	get busy(): boolean {
		return this.isRunning;
	}

	// ── Private ──────────────────────────────────────────────────────

	/**
	 * Start draining the queue if it isn't already running.
	 * This method is intentionally not `async` on the outer call — it
	 * fires off a promise chain without blocking the caller.
	 */
	private drain(): void {
		if (this.isRunning) return;
		// Schedule on the next microtask so the caller's synchronous code
		// completes before we start executing jobs.
		Promise.resolve().then(() => this.runNext());
	}

	/**
	 * Process jobs one at a time until the queue is empty.
	 */
	private async runNext(): Promise<void> {
		if (this.isRunning || this.pending.length === 0) return;

		this.isRunning = true;
		const job = this.pending.shift()!;
		this.currentJob = job;

		try {
			await scrapeLinkAndSummarise({
				title: job.title,
				url: job.url,
				auditLogService: this.auditLogService,
				linkSummaryService: this.linkSummaryService,
				profileService: this.profileService
			});

			// After a successful scrape, embed the summary into the vector store
			// so the resume agent can do semantic search across all link summaries.
			if (this.linkSummaryVectorService) {
				const record = this.linkSummaryService.getByTitle(job.title);
				if (record && record.status === 'done' && record.summary.trim().length > 0) {
					try {
						await this.linkSummaryVectorService.upsertEmbedding(record.id, record.summary);
					} catch (embedErr) {
						// Embedding failure is non-fatal — the summary is still stored in the DB.
						const message = embedErr instanceof Error ? embedErr.message : String(embedErr);
						console.warn(
							`[LinkSummaryQueue] Failed to embed summary for "${job.title}": ${message}`
						);
					}
				}
			}
		} catch (err) {
			// scrapeLinkAndSummarise handles its own error logging and DB state.
			// This catch is just a safety net for completely unexpected throws.
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[LinkSummaryQueue] Unexpected error for job "${job.title}":`, message);

			this.auditLogService.create({
				category: 'profile',
				agent_id: 'link-summariser',
				status: 'error',
				title: `Link summary job crashed: "${job.title}"`,
				detail: message,
				meta: { link_title: job.title, url: job.url }
			});

			// Make sure the DB record reflects the error so the UI doesn't
			// show it stuck in "running".
			try {
				this.linkSummaryService.markError(job.title, `Unexpected crash: ${message}`);
			} catch {
				// Ignore secondary DB errors
			}
		} finally {
			this.currentJob = null;
			this.isRunning = false;

			// Continue draining if there are more jobs
			if (this.pending.length > 0) {
				// Small yield to allow event loop to breathe between jobs
				await new Promise<void>((resolve) => setTimeout(resolve, 200));
				this.runNext();
			}
		}
	}

	/**
	 * Detect the summary type from title/URL for the initial pending record.
	 */
	private detectType(title: string, url: string): 'github' | 'linkedin' | 'portfolio' | 'generic' {
		const lt = title.toLowerCase();
		const lu = url.toLowerCase();
		if (lt.includes('github') || lu.includes('github.com')) return 'github';
		if (lt.includes('linkedin') || lu.includes('linkedin.com')) return 'linkedin';
		if (lt.includes('portfolio') || lt.includes('website') || lt.includes('site'))
			return 'portfolio';
		return 'generic';
	}
}
