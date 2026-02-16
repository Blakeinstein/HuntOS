import { Agent } from '@mastra/core/agent';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { Memory } from '@mastra/memory';
import { loadPrompt } from '../prompts/load';
import { browserTools } from '../tools/browser';
import {
	scrapeResultSchema,
	jobBoardRequestContextSchema,
	type JobBoardRequestContext
} from './job-board-agent.types';

const openrouter = createOpenRouter({
	apiKey: process.env.OPENROUTER_API_KEY
});

/**
 * Creates a job board scraping agent that uses browser tools to navigate
 * a job board URL and extract job listings.
 *
 * Dynamic payloads are passed via `requestContext`:
 * - `job-board-url`: The search results page URL to scrape.
 * - `user-profile`: JSON-serialized user profile for relevance scoring.
 *
 * We use `Agent` directly (instead of the `createAgent` helper) because
 * `instructions` must be a function that reads `requestContext` at runtime
 * and injects the target URL + user profile into the prompt.
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
	const basePrompt = loadPrompt('job-board-agent');
	const memory = new Memory();

	return new Agent({
		id: 'job-board-agent',
		name: 'Job Board Scraping Agent',
		requestContextSchema: jobBoardRequestContextSchema,
		instructions: ({ requestContext }) => {
			const url = requestContext.get('job-board-url') as JobBoardRequestContext['job-board-url'];
			const profileJson = requestContext.get(
				'user-profile'
			) as JobBoardRequestContext['user-profile'];

			return [
				basePrompt,
				'\n\n## Runtime Context\n',
				`### Target URL\n\`${url}\`\n`,
				`### User Profile\n\`\`\`json\n${profileJson}\n\`\`\`\n`
			].join('');
		},
		model: openrouter('google/gemini-2.5-flash'),
		memory,
		tools: {
			...browserTools
		}
	});
}

export { scrapeResultSchema, type JobBoardRequestContext };
