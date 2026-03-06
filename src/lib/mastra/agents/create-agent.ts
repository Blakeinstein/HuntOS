// src/lib/mastra/agents/create-agent.ts
// Central agent factory — creates Mastra Agents with multi-provider model support.
//
// Models are resolved via the provider registry using a "provider/model-path"
// string read from environment variables. Each agent file defines its own
// env var name (e.g. PROFILE_AGENT_MODEL) so models can be swapped per-agent
// without touching code.
//
// Supported provider prefixes: openrouter, openai, lmstudio, github-models, ollama, z-ai
// Format: "openrouter/qwen/qwen3-30b-a3b-instruct-2507"
//         "lmstudio/qwen/qwen3-30b-a3b-2507"
//         "github-models/openai/gpt-4o"
//         "openai/gpt-4o"
//         "ollama/llama3.2"
//         "z-ai/glm-4.7-flash"

// Apply the CoreToolBuilder patch before any agent or tool is constructed.
// This ensures `toModelOutput` (used by vision tools) survives the
// Tool → CoreTool conversion inside makeCoreTool().
import '../tools/patch-core-tool-builder';

import { Agent } from '@mastra/core/agent';
import type { AgentConfig, ToolsInput } from '@mastra/core/agent';
import { RequestContext } from '@mastra/core/request-context';
import { Memory } from '@mastra/memory';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { env } from '$env/dynamic/private';
import { resolveEmbeddingModel, resolveModel } from '../providers';
import { promptRegistry } from '../prompts/load';

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
	 * A fully-qualified model string in the format `<provider>/<model-path>`.
	 *
	 * This should be read from an environment variable in the calling agent file
	 * so that models can be swapped without code changes.
	 *
	 * Falls back to the DEFAULT_MODEL constant if not provided.
	 *
	 * @example
	 * ```ts
	 * import { env } from '$env/dynamic/private';
	 * createAgent({ model: env.PROFILE_AGENT_MODEL ?? 'openrouter/qwen/qwen3-30b-a3b-instruct-2507' })
	 * ```
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

/** Hardcoded fallback if DEFAULT_MODEL env var is also unset. */
const HARDCODED_FALLBACK = 'openrouter/qwen/qwen3-30b-a3b-instruct-2507';

/**
 * Factory that creates a Mastra Agent with multi-provider model support.
 *
 * The `model` parameter accepts a provider-qualified string such as
 * `"openrouter/qwen/qwen3-30b"` or `"ollama/llama3.2"`. The provider
 * registry resolves this to the correct AI SDK LanguageModel instance.
 *
 * Instructions are loaded from `src/lib/mastra/prompts/{id}.md` via the
 * prompt registry so prompts can be edited as plain markdown without
 * touching code.
 *
 * When `dynamicContext` is provided, `instructions` becomes a function that
 * reads `requestContext` at runtime, builds context sections, and appends
 * them to the base prompt — following the Mastra dynamic instructions pattern.
 *
 * @see https://mastra.ai/docs/server/request-context#fetching-from-a-prompt-registry
 */
/** Shared DB URL for all agent memory storage. */
const MEMORY_DB_URL = 'file:./data/memory.db';

/**
 * Resolves the embedding model string from EMBEDDING_MODEL env var,
 * mirroring the pattern used by DocumentService and LinkSummaryVectorService.
 */
function getEmbeddingModel() {
	return resolveEmbeddingModel(
		env.EMBEDDING_MODEL ?? 'lmstudio/text-embedding-nomic-embed-text-v1.5'
	);
}

export function createAgent({
	id,
	model,
	tools,
	dynamicContext,
	...rest
}: CreateAgentOptions): Agent {
	const memory = new Memory({
		storage: new LibSQLStore({
			id: 'agent-memory-storage',
			url: MEMORY_DB_URL
		}),
		vector: new LibSQLVector({
			id: 'agent-memory-vector',
			url: MEMORY_DB_URL
		}),
		embedder: getEmbeddingModel(),
		options: {
			lastMessages: 20,
			semanticRecall: {
				topK: 5,
				messageRange: 2
			}
		}
	});

	const resolvedModel = resolveModel(model ?? env.DEFAULT_MODEL ?? HARDCODED_FALLBACK);

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
