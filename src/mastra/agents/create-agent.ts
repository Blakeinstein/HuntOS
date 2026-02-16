import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { Agent } from '@mastra/core/agent';
import type { AgentConfig, ToolsInput } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { loadPrompt } from '../prompts/load';

const openrouter = createOpenRouter({
	apiKey: process.env.OPENROUTER_API_KEY
});

export type CreateAgentOptions = Omit<
	AgentConfig<string, ToolsInput, undefined, unknown>,
	'instructions' | 'memory' | 'model'
> & {
	/**
	 * The ID of the agent, used to load instructions from `src/mastra/prompts/{id}.md`.
	 * For example, an agent with `id: 'profile-agent'` will load instructions from `src/mastra/prompts/profile-agent.md`.
	 */
	id: string;
	/**
	 * OpenRouter model identifier (e.g. "google/gemini-2.5-flash").
	 * Defaults to "google/gemini-2.5-flash" if not provided.
	 */
	model?: string;
};

/**
 * Factory that creates a Mastra Agent.
 * Instructions are loaded from `src/mastra/prompts/{id}.md` so prompts
 * can be edited as plain markdown without touching code.
 */
export function createAgent({ id, model, tools, ...rest }: CreateAgentOptions): Agent {
	const instructions = loadPrompt(id);
	const memory = new Memory();

	return new Agent({
		id,
		instructions,
		model: openrouter(model ?? 'google/gemini-2.5-flash'),
		memory,
		tools,
		...rest
	});
}
