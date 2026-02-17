import { z } from 'zod';

/**
 * Schema for an individual scraped job posting returned by the agent.
 */
export const scrapedJobSchema = z.object({
	title: z.string().describe('The job title'),
	company: z.string().describe('The company name'),
	location: z.string().optional().describe('The job location if available'),
	url: z.string().url().describe('The absolute URL for the individual job posting'),
	salary_range: z.string().optional().describe('The salary range if displayed'),
	posted_at: z.string().optional().describe('When the job was posted'),
	relevance: z
		.enum(['high', 'medium', 'low'])
		.describe('Relevance score based on user profile match')
});

export type ScrapedJob = z.infer<typeof scrapedJobSchema>;

/**
 * Schema for the full structured output from the job board scraping agent.
 */
export const scrapeResultSchema = z.object({
	success: z.boolean().describe('Whether the scraping operation succeeded'),
	source_url: z.string().describe('The URL that was scraped'),
	scraped_at: z.string().describe('ISO 8601 timestamp of when the scrape occurred'),
	total_found: z.number().describe('Total number of job listings found'),
	jobs: z.array(scrapedJobSchema).describe('Array of extracted job postings'),
	errors: z.array(z.string()).describe('Any errors encountered during scraping'),
	blocked: z.boolean().describe('Whether the page required authentication or was blocked')
});

export type ScrapeResult = z.infer<typeof scrapeResultSchema>;

/**
 * Request context type for the job board scraping agent.
 * These values are injected at runtime via RequestContext.
 */
export type JobBoardRequestContext = {
	/** The job board search results URL to navigate to and scrape */
	'job-board-url': string;
	/** JSON-serialized user profile data for relevance matching */
	'user-profile': string;
};

/**
 * Schema for validating the request context at runtime.
 */
export const jobBoardRequestContextSchema = z.object({
	'job-board-url': z.string().url(),
	'user-profile': z.string()
});
