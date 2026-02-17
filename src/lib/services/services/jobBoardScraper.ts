import { RequestContext } from '@mastra/core/request-context';
import type { Mastra } from '@mastra/core';
import type { ProfileService } from './profile';
import type { JobBoardService, JobPosting } from './jobBoard';
import {
	scrapeResultSchema,
	type ScrapeResult,
	type JobBoardRequestContext
} from '$lib/mastra/agents/job-board-agent.types';
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
 * Service that orchestrates job board scraping by invoking the
 * `job-board-agent` Mastra agent and persisting discovered postings.
 */
export class JobBoardScraperService {
	private mastra: Mastra;
	private profileService: ProfileService;
	private jobBoardService: JobBoardService;

	constructor(mastra: Mastra, profileService: ProfileService, jobBoardService: JobBoardService) {
		this.mastra = mastra;
		this.profileService = profileService;
		this.jobBoardService = jobBoardService;
	}

	/**
	 * Orchestrates a single job board scrape:
	 *
	 * 1. Loads the job board config + user profile from the database.
	 * 2. Builds a `RequestContext` with the target URL and serialized profile.
	 * 3. Invokes the `job-board-agent` via `agent.generate()` with structured output.
	 * 4. Persists any new job postings as backlog applications.
	 * 5. Updates the job board's `lastRunAt` timestamp.
	 */
	async scrape(options: ScrapeJobBoardOptions): Promise<ScrapeJobBoardResult> {
		const errors: string[] = [];

		// 1. Load the job board configuration
		const jobBoard = await this.jobBoardService.getJobBoard(options.jobBoardId);
		if (!jobBoard) {
			return {
				success: false,
				newApplications: 0,
				duplicatesSkipped: 0,
				scrapeResult: null,
				errors: [`Job board with ID ${options.jobBoardId} not found`]
			};
		}

		const targetUrl = options.url ?? jobBoard.base_url;

		// 2. Load the user profile for relevance scoring
		const profile = await this.profileService.getProfile();
		const profileJson = JSON.stringify(profile, null, 2);

		// 3. Build the RequestContext with dynamic payloads
		const requestContext = new RequestContext<JobBoardRequestContext>();
		requestContext.set('job-board-url', targetUrl);
		requestContext.set('user-profile', profileJson);

		// 4. Invoke the agent
		const agent = this.mastra.getAgent('job-board-agent');

		let scrapeResult: ScrapeResult | null = null;

		logger.info(`[job-board-scraper] starting scrape`, {
			jobBoardId: options.jobBoardId,
			targetUrl
		});

		try {
			const response = await agent.generate(
				`Scrape the job board at the configured URL and extract all visible job listings. ` +
					`Evaluate each listing against the user profile for relevance.`,
				{
					requestContext,
					structuredOutput: {
						schema: scrapeResultSchema
					},
					maxSteps: 30
				}
			);

			scrapeResult = response.object ?? null;

			logger.info(`[job-board-scraper] agent finished`, {
				jobBoardId: options.jobBoardId,
				totalSteps: response.steps?.length,
				totalJobsFound: scrapeResult?.total_found ?? 0,
				finishReason: response.finishReason,
				usage: response.usage
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logger.error(`[job-board-scraper] agent execution failed`, {
				jobBoardId: options.jobBoardId,
				error: message
			});
			errors.push(`Agent execution failed: ${message}`);
			return {
				success: false,
				newApplications: 0,
				duplicatesSkipped: 0,
				scrapeResult: null,
				errors
			};
		}

		if (!scrapeResult) {
			errors.push('Agent returned no structured output');
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
			return {
				success: false,
				newApplications: 0,
				duplicatesSkipped: 0,
				scrapeResult,
				errors
			};
		}

		// 5. Persist new jobs as backlog applications
		const { newApplications, duplicatesSkipped } = await this.persistJobs(
			options.jobBoardId,
			scrapeResult.jobs,
			errors
		);

		// 6. Update the job board's last-checked timestamp
		try {
			await this.jobBoardService.updateLastChecked(options.jobBoardId, new Date().toISOString());
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			errors.push(`Failed to update lastRunAt: ${message}`);
		}

		return {
			success: scrapeResult.success && errors.length === 0,
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
