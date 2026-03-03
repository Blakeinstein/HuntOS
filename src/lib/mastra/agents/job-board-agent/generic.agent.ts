import { env } from '$env/dynamic/private';
import { browserTools } from '../../tools/browser';
import { withToolLoggingAll } from '../../tools/with-logging';
import { createAgent } from '../create-agent';
import { jobBoardRequestContextSchema, type JobBoardRequestContext } from './types';

/**
 * Creates a generic job board scraping sub-agent used as a fallback
 * when no site-specific agent is registered for the target URL.
 *
 * This agent uses heuristic-based extraction strategies — inspecting
 * the accessibility tree and trying multiple CSS selector patterns —
 * to handle arbitrary job board layouts.
 *
 * Prompt: `prompts/job-board-agent/job-board-agent.generic.md`
 */
export function createGenericAgent() {
	const model =
		env.JOB_BOARD_GENERIC_MODEL ??
		env.JOB_BOARD_AGENT_MODEL ??
		'openrouter/qwen/qwen3-30b-a3b-instruct-2507';

	return createAgent({
		id: 'job-board-agent.generic',
		name: 'Generic Job Board Scraping Agent',
		model,
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
