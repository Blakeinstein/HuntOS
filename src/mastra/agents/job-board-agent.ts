import { browserTools } from '../tools/browser';
import { createAgent } from './create-agent';
import {
	scrapeResultSchema,
	jobBoardRequestContextSchema,
	type JobBoardRequestContext
} from './job-board-agent.types';

/**
 * Creates a job board scraping agent that uses browser tools to navigate
 * a job board URL and extract job listings.
 *
 * Dynamic payloads are passed via `requestContext` and injected into the
 * prompt through the `dynamicContext` option on `createAgent`, which uses
 * the prompt registry pattern.
 *
 * - `job-board-url`: The search results page URL to scrape.
 * - `user-profile`: JSON-serialized user profile for relevance scoring.
 *
 * @example
 * ```ts
 * import { RequestContext } from '@mastra/core/request-context';
 *
 * const agent = createJobBoardAgent();
 * const ctx = new RequestContext<JobBoardRequestContext>();
 * ctx.set('job-board-url', 'https://linkedin.com/jobs/search?keywords=typescript');
 * ctx.set('user-profile', JSON.stringify(profileData));
 *
 * const result = await agent.generate('Scrape the configured job board for new listings.', {
 *   requestContext: ctx,
 *   structuredOutput: { schema: scrapeResultSchema },
 * });
 * ```
 */
export function createJobBoardAgent() {
	return createAgent({
		id: 'job-board-agent',
		name: 'Job Board Scraping Agent',
		requestContextSchema: jobBoardRequestContextSchema,
		dynamicContext: ({ requestContext }) => ({
			'Target URL': `\`${requestContext.get('job-board-url') as JobBoardRequestContext['job-board-url']}\``,
			'User Profile': `\`\`\`json\n${requestContext.get('user-profile') as JobBoardRequestContext['user-profile']}\n\`\`\``
		}),
		tools: {
			...browserTools
		}
	});
}

export { scrapeResultSchema, type JobBoardRequestContext };
