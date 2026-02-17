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
 * Extracts the first JSON object or array from a string that may contain
 * markdown fences, surrounding prose, or other non-JSON text.
 *
 * Tries three strategies in order:
 *   1. Fenced code block (```json ... ``` or ``` ... ```)
 *   2. First `{` … last `}` substring (top-level object)
 *   3. First `[` … last `]` substring (top-level array)
 */
function extractJson(text: string): unknown {
	// 1. Try fenced code block
	const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
	if (fenceMatch) {
		try {
			return JSON.parse(fenceMatch[1].trim());
		} catch {
			// fall through
		}
	}

	// 2. Try outermost { … }
	const firstBrace = text.indexOf('{');
	const lastBrace = text.lastIndexOf('}');
	if (firstBrace !== -1 && lastBrace > firstBrace) {
		try {
			return JSON.parse(text.slice(firstBrace, lastBrace + 1));
		} catch {
			// fall through
		}
	}

	// 3. Try outermost [ … ]
	const firstBracket = text.indexOf('[');
	const lastBracket = text.lastIndexOf(']');
	if (firstBracket !== -1 && lastBracket > firstBracket) {
		try {
			return JSON.parse(text.slice(firstBracket, lastBracket + 1));
		} catch {
			// fall through
		}
	}

	return undefined;
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

		const targetUrl = options.url ?? paginationState.resumePageUrl ?? jobBoard.base_url;

		// Resolve the site-specific sub-agent via the registry
		const entry = this.subAgentRegistry.resolve(targetUrl);
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
				agentId
			}
		});

		// 2. Load the user profile for relevance scoring
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
					`Evaluate each listing against the user profile for relevance. ` +
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

		// 8. Update pagination bookmark so the next scrape resumes from here
		try {
			if (scrapeResult.current_page && scrapeResult.current_page_url) {
				await this.jobBoardService.updatePaginationState(
					options.jobBoardId,
					scrapeResult.current_page,
					scrapeResult.current_page_url
				);
			} else if (scrapeResult.current_page) {
				// Agent reported a page number but no URL — save what we can
				await this.jobBoardService.updatePaginationState(
					options.jobBoardId,
					scrapeResult.current_page,
					targetUrl
				);
			}
			// If the agent reported neither, we leave the existing bookmark untouched
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
	 * Persists scraped jobs as backlog applications, tracking new vs duplicate counts.
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
				salary_range: job.salary_range,
				job_description_url: job.url,
				posted_at: job.posted_at ?? new Date().toISOString(),
				created_at: new Date().toISOString()
			};

			try {
				const appId = await this.jobBoardService.addApplicationFromJob(posting);
				if (appId > 0) {
					newApplications++;
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				errors.push(`Failed to persist job "${job.title}" at ${job.company}: ${message}`);
				duplicatesSkipped++;
			}
		}

		return { newApplications, duplicatesSkipped };
	}
}
