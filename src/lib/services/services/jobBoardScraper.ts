import { RequestContext } from '@mastra/core/request-context';
import type { Mastra } from '@mastra/core';
import type { ProfileService } from './profile';
import type { JobBoardService, JobPosting } from './jobBoard';
import type { PaginationState } from './jobBoard';
import type { AuditLogService } from './auditLog';
import {
	scrapeResultSchema,
	type ScrapeResult,
	type JobBoardRequestContext,
	type PaginationContext,
	type SubAgentRegistry
} from '$lib/mastra/agents/job-board-agent/index';
import { extractJson } from '$lib/services/helpers/extractJson';
import { logger } from '$lib/mastra/logger';

export interface ScrapeJobBoardOptions {
	/** The job board database ID */
	jobBoardId: number;
	/** Override the URL to scrape (defaults to the job board's configured URL) */
	url?: string;
}

export interface ScrapeJobBoardResult {
	/** Whether the scrape + persistence pipeline succeeded */
	success: boolean;
	/** Number of new applications created in the backlog */
	newApplications: number;
	/** Number of jobs that were already in the system */
	duplicatesSkipped: number;
	/** The raw scrape result from the agent */
	scrapeResult: ScrapeResult | null;
	/** Any errors encountered */
	errors: string[];
}

/**
 * Parses the agent's free-form text response into a validated ScrapeResult.
 *
 * Returns `null` when the text contains no parseable / valid JSON.
 * Validation errors are pushed into the provided `errors` array.
 */
function parseAgentResponse(text: string, errors: string[]): ScrapeResult | null {
	const raw = extractJson(text);
	if (raw === undefined) {
		errors.push('Agent response did not contain parseable JSON');
		logger.warn('[job-board-scraper] no JSON found in agent response', {
			textLength: text.length,
			textPreview: text.slice(0, 500)
		});
		return null;
	}

	const parsed = scrapeResultSchema.safeParse(raw);
	if (!parsed.success) {
		const issues = parsed.error.issues
			.map((i) => `${String(i.path.join('.'))}: ${i.message}`)
			.join('; ');
		errors.push(`Agent JSON failed schema validation: ${issues}`);
		logger.warn('[job-board-scraper] schema validation failed', {
			issues: parsed.error.issues,
			rawPreview: JSON.stringify(raw).slice(0, 1000)
		});
		return null;
	}

	return parsed.data;
}

/**
 * Service that orchestrates job board scraping by invoking the
 * `job-board-agent` Mastra agent and persisting discovered postings.
 */
export class JobBoardScraperService {
	private mastra: Mastra;
	private profileService: ProfileService;
	private jobBoardService: JobBoardService;
	private subAgentRegistry: SubAgentRegistry;
	private auditLog: AuditLogService;

	constructor(
		mastra: Mastra,
		profileService: ProfileService,
		jobBoardService: JobBoardService,
		subAgentRegistry: SubAgentRegistry,
		auditLogService: AuditLogService
	) {
		this.mastra = mastra;
		this.profileService = profileService;
		this.jobBoardService = jobBoardService;
		this.subAgentRegistry = subAgentRegistry;
		this.auditLog = auditLogService;
	}

	/**
	 * Orchestrates a single job board scrape:
	 *
	 * 1. Loads the job board config + user profile from the database.
	 * 2. Resolves pagination state (resume page or start fresh based on retention).
	 * 3. Builds a `RequestContext` with the target URL, serialized profile,
	 *    and pagination context (max listings + resume page).
	 * 4. Invokes the sub-agent via `agent.generate()` **without** structuredOutput
	 *    so that the model is free to call browser tools across multiple steps.
	 * 5. Parses the agent's text response as JSON and validates with Zod.
	 * 6. Persists any new job postings as backlog applications.
	 * 7. Updates the job board's `lastRunAt` timestamp and pagination bookmark.
	 *
	 * ### Pagination advancement logic
	 *
	 * The agent reports `current_page`, `current_page_url`, and `has_more_pages`
	 * after each scrape session.
	 *
	 * - If `has_more_pages` is `true`, the bookmark is set to `current_page + 1`
	 *   so the **next** session starts on the page after the one already scraped
	 *   (avoids re-scraping the same page).
	 * - If `has_more_pages` is `false`, the bookmark is cleared so the next session
	 *   starts from the beginning (the board has been fully traversed).
	 */
	async scrape(options: ScrapeJobBoardOptions): Promise<ScrapeJobBoardResult> {
		const errors: string[] = [];

		// 1. Load the job board configuration
		const jobBoard = await this.jobBoardService.getJobBoard(options.jobBoardId);
		if (!jobBoard) {
			this.auditLog.create({
				category: 'scrape',
				status: 'error',
				title: `Job board not found (ID: ${options.jobBoardId})`,
				detail: `Attempted to scrape a job board that does not exist in the database.`,
				meta: { jobBoardId: options.jobBoardId }
			});

			return {
				success: false,
				newApplications: 0,
				duplicatesSkipped: 0,
				scrapeResult: null,
				errors: [`Job board with ID ${options.jobBoardId} not found`]
			};
		}

		// 1b. Resolve pagination state (handles retention expiry automatically)
		const paginationState: PaginationState = await this.jobBoardService.resolvePaginationState(
			options.jobBoardId
		);

		const paginationContext: PaginationContext = {
			resume_page: paginationState.resumePage,
			resume_page_url: paginationState.resumePageUrl,
			max_listings: paginationState.maxListings
		};

		// The target URL the agent should navigate to.
		// If we have a resume URL from a previous session, start there.
		// If the caller explicitly overrides the URL, use that instead.
		const targetUrl = options.url ?? paginationState.resumePageUrl ?? jobBoard.base_url;

		// Always resolve the sub-agent against the *base* URL so that pagination
		// query params (e.g. &start=50) don't accidentally cause a routing mismatch.
		const entry = this.subAgentRegistry.resolve(jobBoard.base_url);
		const agentId = entry?.agentId ?? 'job-board-agent.generic';
		const detectedBoard = entry?.board ?? 'generic';

		// Start the audit log timer
		const finishAudit = this.auditLog.start({
			category: 'scrape',
			agent_id: agentId,
			title: `Scraping ${jobBoard.name} (${detectedBoard})`,
			detail: `Target URL: ${targetUrl}`,
			meta: {
				jobBoardId: options.jobBoardId,
				jobBoardName: jobBoard.name,
				targetUrl,
				detectedBoard,
				agentId,
				resumePage: paginationContext.resume_page
			}
		});

		// 2. Load the user profile for context (job preferences, target roles)
		const profile = await this.profileService.getProfile();
		const profileJson = JSON.stringify(profile, null, 2);

		// 3. Build the RequestContext with dynamic payloads
		const requestContext = new RequestContext<JobBoardRequestContext>();
		requestContext.set('job-board-url', targetUrl);
		requestContext.set('user-profile', profileJson);
		requestContext.set('pagination-context', JSON.stringify(paginationContext));

		// 4. Invoke the agent — NO structuredOutput so tools are called normally
		const agent = this.mastra.getAgent(agentId);

		let scrapeResult: ScrapeResult | null = null;

		logger.info(`[job-board-scraper] starting scrape`, {
			jobBoardId: options.jobBoardId,
			targetUrl,
			resolvedAgent: agentId,
			detectedBoard,
			resumePage: paginationContext.resume_page,
			maxListings: paginationContext.max_listings
		});

		try {
			const response = await agent.generate(
				`Scrape the job board at the configured URL and extract all visible job listings. ` +
					`For each listing, extract the job title, company name, location, job type (remote/hybrid/on-site), ` +
					`salary range, and any visible description or responsibilities. ` +
					`Do NOT attempt to apply for any jobs or interact with application forms. ` +
					`You MUST include current_page, current_page_url, and has_more_pages in your JSON response. ` +
					`Return your final answer as a single JSON object (no surrounding text).`,
				{
					requestContext,
					maxSteps: 30
				}
			);

			logger.info(`[job-board-scraper] agent finished`, {
				jobBoardId: options.jobBoardId,
				totalSteps: response.steps?.length,
				finishReason: response.finishReason,
				usage: response.usage,
				toolCallCount: response.toolCalls?.length ?? 0,
				textLength: response.text?.length ?? 0
			});

			// 5. Parse the free-form text response into a validated ScrapeResult
			const agentText = response.text ?? '';
			scrapeResult = parseAgentResponse(agentText, errors);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logger.error(`[job-board-scraper] agent execution failed`, {
				jobBoardId: options.jobBoardId,
				error: message
			});
			errors.push(`Agent execution failed: ${message}`);

			finishAudit({
				status: 'error',
				detail: `Agent execution failed: ${message}`,
				meta: { jobBoardId: options.jobBoardId, targetUrl, error: message }
			});

			return {
				success: false,
				newApplications: 0,
				duplicatesSkipped: 0,
				scrapeResult: null,
				errors
			};
		}

		if (!scrapeResult) {
			finishAudit({
				status: 'error',
				detail: `Agent response could not be parsed: ${errors.join('; ')}`,
				meta: { jobBoardId: options.jobBoardId, targetUrl }
			});

			return {
				success: false,
				newApplications: 0,
				duplicatesSkipped: 0,
				scrapeResult: null,
				errors
			};
		}

		// Carry forward any agent-reported errors
		if (scrapeResult.errors.length > 0) {
			errors.push(...scrapeResult.errors);
		}

		if (scrapeResult.blocked) {
			finishAudit({
				status: 'warning',
				detail: `Blocked by ${detectedBoard} — login or CAPTCHA required. Errors: ${scrapeResult.errors.join('; ')}`,
				meta: {
					jobBoardId: options.jobBoardId,
					targetUrl,
					blocked: true,
					agentErrors: scrapeResult.errors
				}
			});

			return {
				success: false,
				newApplications: 0,
				duplicatesSkipped: 0,
				scrapeResult,
				errors
			};
		}

		// 6. Persist new jobs as backlog applications
		const { newApplications, duplicatesSkipped } = await this.persistJobs(
			options.jobBoardId,
			scrapeResult.jobs,
			errors
		);

		// 7. Update the job board's last-checked timestamp
		try {
			await this.jobBoardService.updateLastChecked(options.jobBoardId, new Date().toISOString());
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			errors.push(`Failed to update lastRunAt: ${message}`);
		}

		// 8. Update pagination bookmark for the next scrape session
		try {
			await this.advancePagination(options.jobBoardId, scrapeResult);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			errors.push(`Failed to update pagination state: ${message}`);
		}

		const overallSuccess = scrapeResult.success && errors.length === 0;

		finishAudit({
			status: overallSuccess ? 'success' : errors.length > 0 ? 'warning' : 'success',
			detail: overallSuccess
				? `Found ${scrapeResult.total_found} jobs — ${newApplications} new, ${duplicatesSkipped} duplicates skipped`
				: `Completed with issues: ${errors.join('; ')}`,
			meta: {
				jobBoardId: options.jobBoardId,
				targetUrl,
				totalFound: scrapeResult.total_found,
				newApplications,
				duplicatesSkipped,
				currentPage: scrapeResult.current_page,
				currentPageUrl: scrapeResult.current_page_url,
				hasMorePages: scrapeResult.has_more_pages,
				maxListings: paginationContext.max_listings,
				errors: errors.length > 0 ? errors : undefined
			}
		});

		return {
			success: overallSuccess,
			newApplications,
			duplicatesSkipped,
			scrapeResult,
			errors
		};
	}

	/**
	 * Advances (or resets) the pagination bookmark based on the agent's report.
	 *
	 * **Key rules:**
	 *
	 * - `has_more_pages === true` → The agent stopped because it hit `max_listings`
	 *   but there are more results available. Save `current_page + 1` as the resume
	 *   point so the next session starts on the **next** unscraped page.
	 *
	 * - `has_more_pages === false` → The agent exhausted all available results.
	 *   Clear the bookmark so the next session starts from the beginning (page 1).
	 *   Job boards refresh their listings over time, so starting over is correct.
	 *
	 * - If the agent didn't report pagination fields at all (shouldn't happen with
	 *   the updated schema, but defensively handled), leave the bookmark untouched.
	 */
	private async advancePagination(jobBoardId: number, result: ScrapeResult): Promise<void> {
		const { current_page, current_page_url, has_more_pages } = result;

		// If the agent didn't report pagination fields, leave the bookmark as-is
		if (current_page == null || current_page_url == null) {
			logger.warn('[job-board-scraper] agent omitted pagination fields — bookmark unchanged', {
				jobBoardId,
				current_page,
				current_page_url,
				has_more_pages
			});
			return;
		}

		if (has_more_pages) {
			// More pages exist — advance the bookmark to the next page.
			// We store `current_page + 1` so the next session navigates *past*
			// the page we just scraped instead of re-scraping it.
			const nextPage = current_page + 1;

			// Try to compute the next page URL by incrementing the pagination
			// query parameter in the current URL. If we can't figure it out,
			// fall back to storing the current URL — the agent prompt instructs
			// the agent to navigate to resume_page_url, so even if the URL is
			// slightly stale the agent will still start at the right page number.
			const nextPageUrl = this.buildNextPageUrl(current_page_url, nextPage) ?? current_page_url;

			logger.info('[job-board-scraper] advancing pagination bookmark', {
				jobBoardId,
				scrapedPage: current_page,
				nextPage,
				nextPageUrl,
				has_more_pages
			});

			await this.jobBoardService.updatePaginationState(jobBoardId, nextPage, nextPageUrl);
		} else {
			// No more pages — the board has been fully traversed.
			// Clear the bookmark so the next session starts from page 1.
			logger.info('[job-board-scraper] resetting pagination — no more pages', {
				jobBoardId,
				scrapedPage: current_page,
				has_more_pages
			});

			await this.jobBoardService.resetPaginationState(jobBoardId);
		}
	}

	/**
	 * Attempts to compute the URL for the next page by detecting and incrementing
	 * common pagination query parameters in the current page URL.
	 *
	 * Supports patterns like:
	 *   - `&start=25`  (LinkedIn — offset-based, increments by page size)
	 *   - `&page=2`    (generic — 1-based page number)
	 *   - `&p=2`       (generic — shorthand page number)
	 *   - `&offset=25` (generic — offset-based)
	 *
	 * Returns `null` if no known pagination parameter was detected.
	 */
	private buildNextPageUrl(currentUrl: string, nextPage: number): string | null {
		try {
			const url = new URL(currentUrl);
			const params = url.searchParams;

			// LinkedIn: `start` is an offset (items-per-page * (page - 1))
			if (params.has('start')) {
				const currentStart = Number(params.get('start'));
				if (!Number.isNaN(currentStart)) {
					// Infer page size from the current offset and page number.
					// If we're on page 2 with start=25, page size = 25.
					// If we can't infer it, assume 25 (LinkedIn's default).
					const currentPage = nextPage - 1; // the page we just scraped
					const pageSize = currentPage > 1 ? Math.round(currentStart / (currentPage - 1)) : 25;
					params.set('start', String(pageSize * (nextPage - 1)));
					return url.toString();
				}
			}

			// Generic: `page` or `p` (1-based page number)
			if (params.has('page')) {
				params.set('page', String(nextPage));
				return url.toString();
			}
			if (params.has('p')) {
				params.set('p', String(nextPage));
				return url.toString();
			}

			// Generic: `offset` (assumes same offset stride)
			if (params.has('offset')) {
				const currentOffset = Number(params.get('offset'));
				if (!Number.isNaN(currentOffset)) {
					const currentPage = nextPage - 1;
					const stride = currentPage > 1 ? Math.round(currentOffset / (currentPage - 1)) : 25;
					params.set('offset', String(stride * (nextPage - 1)));
					return url.toString();
				}
			}

			// No recognised pagination param — return null so the caller can
			// fall back to storing the current URL.
			return null;
		} catch {
			// URL parsing failed — not a valid URL
			return null;
		}
	}

	/**
	 * Persists scraped jobs as backlog applications, tracking new vs duplicate counts.
	 *
	 * Only listing details are stored — no form fields are generated since
	 * the scraper's sole job is to collect job postings, not apply for them.
	 *
	 * Uses the `{ id, isNew }` return value from `addApplicationFromJob` to
	 * accurately count new inserts vs duplicates that already existed.
	 */
	private async persistJobs(
		jobBoardId: number,
		jobs: ScrapeResult['jobs'],
		errors: string[]
	): Promise<{ newApplications: number; duplicatesSkipped: number }> {
		let newApplications = 0;
		let duplicatesSkipped = 0;

		for (const job of jobs) {
			const posting: JobPosting = {
				job_board_id: jobBoardId,
				title: job.title,
				company: job.company,
				location: job.location,
				job_type: job.job_type ?? 'unknown',
				salary_range: job.salary_range,
				description: job.description,
				job_description_url: job.url,
				posted_at: job.posted_at ?? new Date().toISOString(),
				created_at: new Date().toISOString()
			};

			try {
				const { isNew } = await this.jobBoardService.addApplicationFromJob(posting);
				if (isNew) {
					newApplications++;
				} else {
					duplicatesSkipped++;
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				errors.push(`Failed to persist job "${job.title}" at ${job.company}: ${message}`);
			}
		}

		return { newApplications, duplicatesSkipped };
	}
}
