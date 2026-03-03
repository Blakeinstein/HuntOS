import { createAgent } from '../create-agent';

const JOB_BOARD_AGENT_MODEL =
	process.env.JOB_BOARD_AGENT_MODEL ?? 'openrouter/qwen/qwen3-30b-a3b-instruct-2507';
import { SubAgentRegistry } from './registry';
import { createLinkedInAgent } from './linkedin.agent';
import { createGreenhouseAgent } from './greenhouse.agent';
import { createGenericAgent } from './generic.agent';
import {
	routingDecisionSchema,
	jobBoardRequestContextSchema,
	type JobBoardRequestContext
} from './types';

/**
 * Creates and populates the sub-agent registry with all known
 * job-board-specific agents.
 *
 * Entries are evaluated in registration order — more specific patterns
 * are registered first, with the generic fallback always last.
 *
 * @example
 * ```ts
 * const registry = createJobBoardSubAgentRegistry();
 * const entry = registry.resolveOrThrow('https://www.linkedin.com/jobs/search?keywords=ts');
 * const agent = entry.create(); // LinkedIn-specific agent
 * ```
 */
export function createJobBoardSubAgentRegistry(): SubAgentRegistry {
	const registry = new SubAgentRegistry();

	registry
		.register({
			board: 'LinkedIn',
			agentId: 'job-board-agent.linkedin',
			match: (url) => /linkedin\.com/i.test(url),
			create: () => createLinkedInAgent()
		})
		.register({
			board: 'Greenhouse',
			agentId: 'job-board-agent.greenhouse',
			match: (url) => /greenhouse\.io/i.test(url),
			create: () => createGreenhouseAgent()
		})
		.register({
			board: 'Generic',
			agentId: 'job-board-agent.generic',
			match: () => true, // catch-all fallback — always matches
			create: () => createGenericAgent()
		});

	return registry;
}

/**
 * Creates the top-level job board orchestrator agent.
 *
 * This agent does NOT scrape pages itself. Instead, it analyzes the
 * target URL and returns a routing decision indicating which site-specific
 * sub-agent should handle the actual scraping.
 *
 * The orchestrator's prompt is loaded from:
 *   `src/lib/mastra/prompts/job-board-agent/job-board-agent.md`
 *
 * It receives the same request context as the sub-agents (job-board-url
 * and user-profile) but only uses the URL to make a routing decision.
 *
 * @example
 * ```ts
 * import { RequestContext } from '@mastra/core/request-context';
 *
 * const orchestrator = createJobBoardAgent();
 * const ctx = new RequestContext<JobBoardRequestContext>();
 * ctx.set('job-board-url', 'https://www.linkedin.com/jobs/search?keywords=typescript');
 * ctx.set('user-profile', JSON.stringify(profileData));
 *
 * const result = await orchestrator.generate('Route this scraping request.', {
 *   requestContext: ctx,
 *   structuredOutput: { schema: routingDecisionSchema },
 * });
 *
 * // result.object => { detected_board: "linkedin", sub_agent_id: "job-board-agent.linkedin", ... }
 * ```
 */
export function createJobBoardAgent() {
	return createAgent({
		id: 'job-board-agent',
		name: 'Job Board Orchestrator Agent',
		model: JOB_BOARD_AGENT_MODEL,
		requestContextSchema: jobBoardRequestContextSchema,
		dynamicContext: ({ requestContext }) => ({
			'Target URL': `\`${requestContext.get('job-board-url') as JobBoardRequestContext['job-board-url']}\``,
			'User Profile': `\`\`\`json\n${requestContext.get('user-profile') as JobBoardRequestContext['user-profile']}\n\`\`\``,
			'Pagination Context': `\`\`\`json\n${requestContext.get('pagination-context') as JobBoardRequestContext['pagination-context']}\n\`\`\``
		})
		// No tools — the orchestrator only analyzes the URL and returns a routing decision.
	});
}

export { routingDecisionSchema };
