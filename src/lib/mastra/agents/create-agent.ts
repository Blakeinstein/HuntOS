import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { Agent } from '@mastra/core/agent';
import type { AgentConfig, ToolsInput } from '@mastra/core/agent';
import { RequestContext } from '@mastra/core/request-context';
import { Memory } from '@mastra/memory';
import { OPENROUTER_API_KEY } from '$env/static/private';
import { promptRegistry } from '../prompts/load';

/**
 * Central OpenRouter instance shared by all agents.
 * Import this from here instead of creating new instances per agent.
 */
export const openrouter = createOpenRouter({
	apiKey: OPENROUTER_API_KEY
});

/** The default model used by all agents unless overridden. */
const DEFAULT_MODEL = 'qwen/qwen3-30b-a3b-instruct-2507';

/**
 * Dynamic context entries that get appended to the base prompt
 * as a "## Runtime Context" section via the prompt registry.
 *
 * Each key becomes a `### Key` subsection with the value as its body.
 */
export type DynamicContext = Record<string, string>;

/**
 * A function that builds dynamic context from requestContext at runtime.
 * Return a key/value record that will be appended to the base prompt.
 */
export type DynamicContextFn = (args: {
	requestContext: RequestContext;
}) => DynamicContext | Promise<DynamicContext>;

export type CreateAgentOptions = Omit<
	AgentConfig<string, ToolsInput, undefined, unknown>,
	'instructions' | 'memory' | 'model'
> & {
	/**
	 * The ID of the agent, used to load instructions from `src/lib/mastra/prompts/{id}.md`.
	 * For example, an agent with `id: 'profile-agent'` will load instructions from
	 * `src/lib/mastra/prompts/profile-agent.md`.
	 */
	id: string;
	/**
	 * OpenRouter model identifier (e.g. "google/gemini-2.5-flash").
	 * Defaults to "minimax/minimax-m2.5" if not provided.
	 */
	model?: string;
	/**
	 * Optional function that receives `{ requestContext }` and returns a
	 * `Record<string, string>` of dynamic context sections to inject into the
	 * prompt at runtime (appended after the base markdown).
	 *
	 * This follows Mastra's "prompt registry" pattern for dynamic instructions.
	 *
	 * @example
	 * ```ts
	 * createAgent({
	 *   id: 'job-board-agent',
	 *   dynamicContext: ({ requestContext }) => ({
	 *     'Target URL': requestContext.get('job-board-url'),
	 *     'User Profile': requestContext.get('user-profile'),
	 *   }),
	 * });
	 * ```
	 */
	dynamicContext?: DynamicContextFn;
};

/**
 * Factory that creates a Mastra Agent.
 *
 * Instructions are loaded from `src/lib/mastra/prompts/{id}.md` via the prompt
 * registry so prompts can be edited as plain markdown without touching code.
 *
 * When `dynamicContext` is provided, `instructions` becomes a function that
 * reads `requestContext` at runtime, builds context sections, and appends
 * them to the base prompt — following the Mastra dynamic instructions pattern.
 *
 * @see https://mastra.ai/docs/server/request-context#fetching-from-a-prompt-registry
 */
export function createAgent({
	id,
	model,
	tools,
	dynamicContext,
	...rest
}: CreateAgentOptions): Agent {
	const memory = new Memory();
	const resolvedModel = openrouter(model ?? DEFAULT_MODEL);

	// When dynamicContext is provided, instructions become a function that
	// fetches the prompt from the registry with injected runtime context.
	const instructions = dynamicContext
		? async ({ requestContext }: { requestContext: RequestContext }) => {
				const context = await dynamicContext({ requestContext });
				const { content } = promptRegistry.getPrompt({ promptId: id, context });
				return content;
			}
		: promptRegistry.getPrompt({ promptId: id }).content;

	return new Agent({
		id,
		instructions,
		model: resolvedModel,
		memory,
		tools,
		...rest
	});
}
