import { z } from 'zod';

/**
 * Pagination state passed to scraping agents at runtime so they know
 * where to resume and how many listings to collect.
 */
export const paginationContextSchema = z.object({
	/** 1-based page number to resume from, or `null` to start from the beginning. */
	resume_page: z.number().int().positive().nullable(),
	/** The full URL of the last scraped page (with pagination query params), or `null`. */
	resume_page_url: z.string().url().nullable(),
	/** Maximum number of job listings to collect in this scrape session. */
	max_listings: z.number().int().positive()
});

export type PaginationContext = z.infer<typeof paginationContextSchema>;

/**
 * The work arrangement / job type for a scraped listing.
 */
export const jobTypeEnum = z
	.enum(['remote', 'hybrid', 'on-site', 'unknown'])
	.describe('The work arrangement: remote, hybrid, on-site, or unknown if not specified');

export type JobType = z.infer<typeof jobTypeEnum>;

/**
 * Schema for an individual scraped job posting returned by the agent.
 *
 * The agent's sole responsibility is to extract factual listing details.
 * No application-related data (form fields, relevance scores, etc.) is included.
 */
export const scrapedJobSchema = z.object({
	title: z.string().describe('The job title'),
	company: z.string().describe('The company name'),
	location: z
		.string()
		.nullable()
		.optional()
		.describe('The job location if available (city, state, country)'),
	url: z.string().url().describe('The absolute URL for the individual job posting'),
	job_type: jobTypeEnum.describe('Work arrangement: remote, hybrid, on-site, or unknown'),
	salary_range: z.string().nullable().optional().describe('The salary range if displayed'),
	description: z
		.string()
		.nullable()
		.optional()
		.describe(
			'A summary of the job description including responsibilities. ' +
				'Extract what is visible on the listing page — do NOT navigate into the job detail page.'
		),
	posted_at: z.string().nullable().optional().describe('When the job was posted')
});

export type ScrapedJob = z.infer<typeof scrapedJobSchema>;

/**
 * Schema for the full structured output from the job board scraping agent.
 */
export const scrapeResultSchema = z.object({
	success: z.boolean().describe('Whether the scraping operation succeeded'),
	source_url: z.string().describe('The URL that was scraped'),
	scraped_at: z.string().describe('ISO 8601 timestamp of when the scrape occurred'),
	total_found: z
		.number()
		.describe(
			'The number of job listings included in the `jobs` array of this response. ' +
				'This MUST equal `jobs.length`.'
		),
	jobs: z.array(scrapedJobSchema).describe('Array of extracted job postings'),
	errors: z.array(z.string()).describe('Any errors encountered during scraping'),
	blocked: z.boolean().describe('Whether the page required authentication or was blocked'),
	/** The 1-based page number the agent stopped on (the last page it scraped). */
	current_page: z
		.number()
		.int()
		.positive()
		.describe(
			'REQUIRED — The 1-based page number the agent finished scraping. ' +
				'For single-page boards (e.g. Greenhouse), this is 1. ' +
				'For paginated boards, this is the last page number the agent visited.'
		),
	/** The full URL of the page the agent stopped on, for resuming next time. */
	current_page_url: z
		.string()
		.describe(
			'REQUIRED — The full URL of the last page scraped, including any pagination query params. ' +
				'The system uses this to resume from the correct position on the next scrape session.'
		),
	/** Whether there are more pages of results beyond the last page the agent scraped. */
	has_more_pages: z
		.boolean()
		.describe(
			'REQUIRED — Whether there are additional pages of results beyond the last page scraped. ' +
				'Set to `true` if the agent stopped because it reached `max_listings` but there were ' +
				'more results available (e.g. a "Next" button or more scroll content existed). ' +
				'Set to `false` if the agent reached the end of all available results.'
		)
});

export type ScrapeResult = z.infer<typeof scrapeResultSchema>;

/**
 * Request context type for job board scraping agents.
 * These values are injected at runtime via RequestContext.
 */
export type JobBoardRequestContext = {
	/** The job board search results URL to navigate to and scrape */
	'job-board-url': string;
	/** JSON-serialized user profile data for context (job preferences, target roles) */
	'user-profile': string;
	/** JSON-serialized pagination context for resume/max-listings behaviour */
	'pagination-context': string;
};

/**
 * Schema for validating the request context at runtime.
 */
export const jobBoardRequestContextSchema = z.object({
	'job-board-url': z.string().url(),
	'user-profile': z.string(),
	'pagination-context': z.string()
});

/**
 * Supported job board identifiers.
 * Used by the orchestrator to route to the correct sub-agent.
 */
export type JobBoardId = 'linkedin' | 'greenhouse' | 'generic';

/**
 * Schema for the orchestrator's routing decision output.
 */
export const routingDecisionSchema = z.object({
	detected_board: z.string().describe('The identified job board name'),
	sub_agent_id: z.string().describe('The dot-notation ID of the sub-agent to delegate to'),
	target_url: z.string().describe('The target URL to pass to the sub-agent'),
	confidence: z
		.enum(['high', 'medium', 'low'])
		.describe('How confident the orchestrator is in the board identification')
});

export type RoutingDecision = z.infer<typeof routingDecisionSchema>;

/**
 * Map of job board identifier to its corresponding sub-agent ID.
 */
export const BOARD_AGENT_MAP: Record<JobBoardId, string> = {
	linkedin: 'job-board-agent.linkedin',
	greenhouse: 'job-board-agent.greenhouse',
	generic: 'job-board-agent.generic'
} as const;
