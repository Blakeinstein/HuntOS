import { browserTools } from '../../tools/browser';

const LINKEDIN_AGENT_MODEL =
	process.env.JOB_BOARD_LINKEDIN_MODEL ??
	process.env.JOB_BOARD_AGENT_MODEL ??
	'openrouter/qwen/qwen3-30b-a3b-instruct-2507';
import { withToolLoggingAll } from '../../tools/with-logging';
import { createAgent } from '../create-agent';
import { jobBoardRequestContextSchema, type JobBoardRequestContext } from './types';

/**
 * Creates a LinkedIn-specific job board scraping agent.
 *
 * This sub-agent is tailored for LinkedIn's DOM structure, login walls,
 * lazy-loading patterns, and URL conventions. It uses the prompt at
 * `prompts/job-board-agent/job-board-agent.linkedin.md` which contains
 * detailed LinkedIn-specific selectors and extraction strategies.
 *
 * @example
 * ```ts
 * import { RequestContext } from '@mastra/core/request-context';
 *
 * const agent = createLinkedInAgent();
 * const ctx = new RequestContext<JobBoardRequestContext>();
 * ctx.set('job-board-url', 'https://www.linkedin.com/jobs/search?keywords=typescript');
 * ctx.set('user-profile', JSON.stringify(profileData));
 *
 * const result = await agent.generate('Scrape LinkedIn for job listings.', {
 *   requestContext: ctx,
 *   structuredOutput: { schema: scrapeResultSchema },
 * });
 * ```
 */
export function createLinkedInAgent() {
	return createAgent({
		id: 'job-board-agent.linkedin',
		name: 'LinkedIn Scraping Agent',
		model: LINKEDIN_AGENT_MODEL,
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
