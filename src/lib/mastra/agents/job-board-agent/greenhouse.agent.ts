import { browserTools } from '../../tools/browser';

const GREENHOUSE_AGENT_MODEL =
	process.env.JOB_BOARD_GREENHOUSE_MODEL ??
	process.env.JOB_BOARD_AGENT_MODEL ??
	'openrouter/qwen/qwen3-30b-a3b-instruct-2507';
import { withToolLoggingAll } from '../../tools/with-logging';
import { createAgent } from '../create-agent';
import {
	scrapeResultSchema,
	jobBoardRequestContextSchema,
	type JobBoardRequestContext
} from './types';

/**
 * Creates a Greenhouse-specific job board scraping agent.
 *
 * This agent is tailored for Greenhouse-hosted career pages
 * (`boards.greenhouse.io/{company}` or custom-domain variants).
 * It understands Greenhouse's DOM structure — department-grouped
 * `.opening` elements, single-page rendering with no pagination,
 * and stable `/jobs/{id}` URLs for deduplication.
 *
 * Instructions are loaded from:
 *   `src/lib/mastra/prompts/job-board-agent/job-board-agent.greenhouse.md`
 *
 * @example
 * ```ts
 * import { RequestContext } from '@mastra/core/request-context';
 *
 * const agent = createGreenhouseAgent();
 * const ctx = new RequestContext<JobBoardRequestContext>();
 * ctx.set('job-board-url', 'https://boards.greenhouse.io/exampleco');
 * ctx.set('user-profile', JSON.stringify(profileData));
 *
 * const result = await agent.generate('Scrape Greenhouse board for job listings.', {
 *   requestContext: ctx,
 *   structuredOutput: { schema: scrapeResultSchema },
 * });
 * ```
 */
export function createGreenhouseAgent() {
	return createAgent({
		id: 'job-board-agent.greenhouse',
		name: 'Greenhouse Scraping Agent',
		model: GREENHOUSE_AGENT_MODEL,
		requestContextSchema: jobBoardRequestContextSchema,
		dynamicContext: ({ requestContext }) => ({
			'Target URL': `\`${requestContext.get('job-board-url') as JobBoardRequestContext['job-board-url']}\``,
			'User Profile': `\`\`\`json\n${requestContext.get('user-profile') as JobBoardRequestContext['user-profile']}\n\`\`\``,
			'Pagination Context': `\`\`\`json\n${requestContext.get('pagination-context') as JobBoardRequestContext['pagination-context']}\n\`\`\``
		}),
		tools: {
			...withToolLoggingAll(browserTools)
		}
	});
}

export { scrapeResultSchema, type JobBoardRequestContext };
