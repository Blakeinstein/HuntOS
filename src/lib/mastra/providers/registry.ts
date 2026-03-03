// src/lib/mastra/providers/registry.ts
// Multi-provider model factory — parses a "provider/model-id" string from env
// and returns the appropriate AI SDK LanguageModel instance.
//
// Supported provider prefixes:
//   openrouter/...    → @openrouter/ai-sdk-provider  (OPENROUTER_API_KEY, OPENROUTER_BASE_URL)
//   openai/...        → @ai-sdk/openai               (OPENAI_API_KEY, OPENAI_BASE_URL)
//   lmstudio/...      → mastra model router string   (LMSTUDIO_API_KEY, LMSTUDIO_BASE_URL)
//   github-models/... → mastra model router string   (GITHUB_TOKEN, GITHUB_MODELS_BASE_URL)
//   ollama/...        → ollama-ai-provider-v2         (OLLAMA_BASE_URL)
//   z-ai/...          → @ai-sdk/openai compat        (ZAI_API_KEY, ZAI_BASE_URL)
//
// Model string format examples:
//   "openrouter/qwen/qwen3-30b-a3b-instruct-2507"
//   "lmstudio/qwen/qwen3-30b-a3b-2507"
//   "github-models/openai/gpt-4o"
//   "openai/gpt-4o"
//   "ollama/llama3.2"
//   "z-ai/glm-4.7-flash"

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createOpenAI } from '@ai-sdk/openai';
import { createOllama } from 'ollama-ai-provider-v2';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { OpenAICompatibleProviderSettings } from '@ai-sdk/openai-compatible';
import type { MastraModelConfig } from '@mastra/core/llm';
import type { EmbeddingModel } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';

// ---------------------------------------------------------------------------
// Env helpers — use SvelteKit's $env/dynamic/private so .env values are
// available at runtime (process.env is NOT populated by Vite for .env files).
// These are called lazily at resolve-time, never at module-load time.
// ---------------------------------------------------------------------------

import { env as svelteEnv } from '$env/dynamic/private';

function env(key: string): string | undefined {
	return svelteEnv[key];
}

function requireEnv(key: string): string {
	const v = env(key);
	if (!v) throw new Error(`[providers] Missing required environment variable: ${key}`);
	return v;
}

// ---------------------------------------------------------------------------
// Provider-specific factory functions
// ---------------------------------------------------------------------------

/**
 * Ensures the LMStudio base URL ends with `/v1`.
 *
 * Users commonly set `LMSTUDIO_BASE_URL=http://host:1234` without the `/v1`
 * suffix, but the AI SDK appends paths like `/chat/completions` directly to
 * the base URL. Without `/v1` the resulting URL hits an invalid endpoint and
 * LMStudio responds with "Unexpected endpoint or method".
 */
function normalizeLMStudioBaseURL(raw: string): string {
	// Strip trailing slashes for consistent comparison
	const trimmed = raw.replace(/\/+$/, '');
	if (trimmed.endsWith('/v1')) return trimmed;
	return `${trimmed}/v1`;
}

/**
 * OpenRouter — passes the full "openrouter/..." string as-is to the SDK.
 * The model ID is everything after the first segment, kept with its sub-path.
 *
 * e.g. "openrouter/qwen/qwen3-30b" → openrouter("qwen/qwen3-30b")
 */
function resolveOpenRouter(modelPath: string): MastraModelConfig {
	const apiKey = requireEnv('OPENROUTER_API_KEY');
	const baseURL = env('OPENROUTER_BASE_URL');
	const client = createOpenRouter({ apiKey, ...(baseURL ? { baseURL } : {}) });
	return client(modelPath) as MastraModelConfig;
}

/**
 * OpenAI — uses @ai-sdk/openai with optional base URL override.
 *
 * e.g. "openai/gpt-4o" → openai("gpt-4o")
 */
function resolveOpenAI(modelPath: string): MastraModelConfig {
	const apiKey = requireEnv('OPENAI_API_KEY');
	const baseURL = env('OPENAI_BASE_URL');
	const client = createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
	return client(modelPath) as MastraModelConfig;
}

/**
 * LMStudio — uses @ai-sdk/openai-compatible with supportsStructuredOutputs: false.
 *
 * LMStudio does not support the OpenAI `json_schema` response format used by
 * `generateObject` when structured outputs are enabled. Setting
 * `supportsStructuredOutputs: false` makes the AI SDK fall back to plain
 * `json` mode (response_format: { type: "json_object" }) which LMStudio
 * handles correctly.
 *
 * e.g. "lmstudio/qwen/qwen3.5-35b-a3b" → lmstudio("qwen/qwen3.5-35b-a3b")
 */
function resolveLMStudio(modelPath: string): MastraModelConfig {
	const baseURL = normalizeLMStudioBaseURL(env('LMSTUDIO_BASE_URL') ?? 'http://127.0.0.1:1234/v1');

	const settings: OpenAICompatibleProviderSettings = {
		name: 'lmstudio',
		baseURL,
		// LMStudio supports response_format: { type: "json_schema" } but
		// rejects { type: "json_object" }.  Setting this to true makes the
		// AI SDK use json_schema mode in generateObject, which is what
		// LMStudio expects.
		supportsStructuredOutputs: true
	};

	const client = createOpenAICompatible(settings);
	return client(modelPath) as MastraModelConfig;
}

/**
 * GitHub Models — Mastra's built-in model router accepts the full prefixed string.
 * Optionally override the inference endpoint via GITHUB_MODELS_BASE_URL.
 *
 * e.g. "github-models/openai/gpt-4o"
 */
function resolveGitHubModels(fullModelId: string): MastraModelConfig {
	const baseURL = env('GITHUB_MODELS_BASE_URL') ?? 'https://models.github.ai/inference';
	const token = requireEnv('GITHUB_TOKEN');

	// Always construct a real OpenAI-compat client so the result is a proper
	// LanguageModel object (not a Mastra router string).
	const client = createOpenAI({ apiKey: token, baseURL });
	return client(fullModelId) as MastraModelConfig;
}

/**
 * Ollama — uses ollama-ai-provider-v2 with optional base URL override.
 *
 * e.g. "ollama/llama3.2" → ollama("llama3.2")
 */
function resolveOllama(modelPath: string): MastraModelConfig {
	const baseURL = env('OLLAMA_BASE_URL'); // default: http://localhost:11434/api
	const client = createOllama({ ...(baseURL ? { baseURL } : {}) });
	return client(modelPath) as MastraModelConfig;
}

/**
 * Z.AI (Zhipu AI / ZAI) — OpenAI-compatible endpoint.
 *
 * When ZAI_API_KEY is set, calls the Z.AI API directly at open.bigmodel.cn
 * (or the override in ZAI_BASE_URL).
 *
 * When ZAI_API_KEY is NOT set, falls back to OpenRouter which also hosts
 * z-ai models — preserving the original behavior of the codebase.
 *
 * e.g. "z-ai/glm-4.7-flash" → zai("glm-4.7-flash")
 */
function resolveZAI(modelPath: string, fullModelId: string): MastraModelConfig {
	const zaiKey = env('ZAI_API_KEY');

	if (zaiKey) {
		// Direct Z.AI API
		const baseURL = env('ZAI_BASE_URL') ?? 'https://open.bigmodel.cn/api/paas/v4/';
		const client = createOpenAI({ apiKey: zaiKey, baseURL });
		return client(modelPath) as MastraModelConfig;
	}

	// Fallback: route through OpenRouter (original behavior)
	// OpenRouter hosts z-ai models under the same "z-ai/..." prefix
	return resolveOpenRouter(fullModelId);
}

// ---------------------------------------------------------------------------
// Provider prefix map
// ---------------------------------------------------------------------------

type ProviderHandler = (modelPath: string, fullModelId: string) => MastraModelConfig;

const PROVIDER_HANDLERS: Record<string, ProviderHandler> = {
	openrouter: (modelPath) => resolveOpenRouter(modelPath),
	openai: (modelPath) => resolveOpenAI(modelPath),
	lmstudio: (modelPath) => resolveLMStudio(modelPath),
	'github-models': (_modelPath, fullModelId) => resolveGitHubModels(fullModelId),
	ollama: (modelPath) => resolveOllama(modelPath),
	'z-ai': (modelPath, fullModelId) => resolveZAI(modelPath, fullModelId)
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolves a provider-qualified model string into an AI SDK LanguageModel.
 *
 * The string format is `<provider>/<model-path>` where `<model-path>` may
 * itself contain slashes (e.g. `openrouter/qwen/qwen3-30b-a3b-instruct-2507`).
 *
 * For providers that use Mastra's built-in model router (lmstudio,
 * github-models) the full prefixed string is returned as-is unless a custom
 * base URL env var is set, in which case an explicit OpenAI-compat client is
 * constructed instead.
 *
 * @example
 * ```ts
 * const model = resolveModel('openrouter/qwen/qwen3-30b-a3b-instruct-2507');
 * const model = resolveModel('lmstudio/qwen/qwen3-30b-a3b-2507');
 * const model = resolveModel('github-models/openai/gpt-4o');
 * const model = resolveModel('openai/gpt-4o');
 * const model = resolveModel('ollama/llama3.2');
 * const model = resolveModel('z-ai/glm-4.7-flash');
 * ```
 */
export function resolveModel(modelId: string): MastraModelConfig {
	const slashIdx = modelId.indexOf('/');
	if (slashIdx === -1) {
		throw new Error(
			`[providers] Invalid model string "${modelId}". ` +
				`Expected format: "<provider>/<model-path>" ` +
				`(e.g. "openrouter/qwen/qwen3-30b", "ollama/llama3.2")`
		);
	}

	// Handle compound provider prefixes like "github-models" before splitting
	let provider: string;
	let modelPath: string;

	if (modelId.startsWith('github-models/')) {
		provider = 'github-models';
		modelPath = modelId.slice('github-models/'.length);
	} else {
		provider = modelId.slice(0, slashIdx);
		modelPath = modelId.slice(slashIdx + 1);
	}

	const handler = PROVIDER_HANDLERS[provider];
	if (!handler) {
		throw new Error(
			`[providers] Unknown provider "${provider}" in model string "${modelId}". ` +
				`Supported providers: ${Object.keys(PROVIDER_HANDLERS).join(', ')}`
		);
	}

	return handler(modelPath, modelId);
}

/**
 * Like {@link resolveModel} but returns a strict `LanguageModelV3` suitable
 * for use with `wrapLanguageModel()` and other AI SDK helpers that require
 * an actual model object rather than a Mastra router string.
 *
 * Throws if the resolved value is a plain string (Mastra router id) instead
 * of a real model object — this should not happen with the current provider
 * implementations since LMStudio / GitHub Models always construct a real
 * OpenAI-compat client, but the guard is here for safety.
 *
 * @example
 * ```ts
 * import { wrapLanguageModel, extractReasoningMiddleware } from 'ai';
 * const base = resolveLanguageModel('lmstudio/qwen/qwen3.5-35b-a3b');
 * const model = wrapLanguageModel({
 *   model: base,
 *   middleware: [extractReasoningMiddleware({ tagName: 'think' })],
 * });
 * ```
 */
export function resolveLanguageModel(modelId: string): LanguageModelV3 {
	const resolved = resolveModel(modelId);

	if (typeof resolved === 'string') {
		throw new Error(
			`[providers] resolveLanguageModel("${modelId}") returned a Mastra router ` +
				`string instead of a model object.  This provider may not support ` +
				`direct SDK usage.  Set the provider's BASE_URL env var to force ` +
				`construction of a real client.`
		);
	}

	return resolved as unknown as LanguageModelV3;
}

// ---------------------------------------------------------------------------
// Embedding model resolution
// ---------------------------------------------------------------------------

type EmbeddingHandler = (modelPath: string) => EmbeddingModel;

/**
 * Provider-specific embedding model factories.
 *
 * Not every provider supports embeddings — only OpenRouter, OpenAI, Ollama,
 * and Z.AI (via OpenAI compat) are wired here.  LMStudio and GitHub Models
 * can be added when their SDKs expose an embedding endpoint.
 */
const EMBEDDING_HANDLERS: Record<string, EmbeddingHandler> = {
	openrouter: (modelPath) => {
		const apiKey = requireEnv('OPENROUTER_API_KEY');
		const baseURL = env('OPENROUTER_BASE_URL');
		const client = createOpenRouter({ apiKey, ...(baseURL ? { baseURL } : {}) });
		return client.textEmbeddingModel(modelPath);
	},
	openai: (modelPath) => {
		const apiKey = requireEnv('OPENAI_API_KEY');
		const baseURL = env('OPENAI_BASE_URL');
		const client = createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
		return client.textEmbeddingModel(modelPath);
	},
	ollama: (modelPath) => {
		const baseURL = env('OLLAMA_BASE_URL');
		const client = createOllama({ ...(baseURL ? { baseURL } : {}) });
		return client.textEmbeddingModel(modelPath);
	},
	lmstudio: (modelPath) => {
		const baseURL = normalizeLMStudioBaseURL(
			env('LMSTUDIO_BASE_URL') ?? 'http://127.0.0.1:1234/v1'
		);
		// LM Studio requires @ai-sdk/openai-compatible — the generic OpenAI
		// provider does not wire up the embeddings endpoint correctly for it.
		// supportsStructuredOutputs is irrelevant for embedding models.
		const client = createOpenAICompatible({ name: 'lmstudio', baseURL });
		return client.embeddingModel(modelPath);
	},
	'z-ai': (modelPath) => {
		const zaiKey = env('ZAI_API_KEY');
		if (zaiKey) {
			const baseURL = env('ZAI_BASE_URL') ?? 'https://open.bigmodel.cn/api/paas/v4/';
			const client = createOpenAI({ apiKey: zaiKey, baseURL });
			return client.textEmbeddingModel(modelPath);
		}
		// Fallback through OpenRouter
		const apiKey = requireEnv('OPENROUTER_API_KEY');
		const baseURL = env('OPENROUTER_BASE_URL');
		const client = createOpenRouter({ apiKey, ...(baseURL ? { baseURL } : {}) });
		return client.textEmbeddingModel(`z-ai/${modelPath}`);
	}
};

/**
 * Resolves a provider-qualified embedding model string into an AI SDK
 * EmbeddingModel instance, using the same `<provider>/<model-path>` format
 * as {@link resolveModel}.
 *
 * @example
 * ```ts
 * const emb = resolveEmbeddingModel('openai/text-embedding-3-small');
 * const emb = resolveEmbeddingModel('openrouter/openai/text-embedding-3-small');
 * const emb = resolveEmbeddingModel('ollama/nomic-embed-text');
 * ```
 */
export function resolveEmbeddingModel(modelId: string): EmbeddingModel {
	const slashIdx = modelId.indexOf('/');
	if (slashIdx === -1) {
		throw new Error(
			`[providers] Invalid embedding model string "${modelId}". ` +
				`Expected format: "<provider>/<model-path>" ` +
				`(e.g. "openai/text-embedding-3-small", "ollama/nomic-embed-text")`
		);
	}

	let provider: string;
	let modelPath: string;

	if (modelId.startsWith('github-models/')) {
		provider = 'github-models';
		modelPath = modelId.slice('github-models/'.length);
	} else {
		provider = modelId.slice(0, slashIdx);
		modelPath = modelId.slice(slashIdx + 1);
	}

	const handler = EMBEDDING_HANDLERS[provider];
	if (!handler) {
		throw new Error(
			`[providers] Provider "${provider}" does not support embedding models, ` +
				`or is unknown. Supported embedding providers: ${Object.keys(EMBEDDING_HANDLERS).join(', ')}`
		);
	}

	return handler(modelPath);
}

/**
 * Returns a list of all supported provider prefixes.
 */
export function getSupportedProviders(): string[] {
	return Object.keys(PROVIDER_HANDLERS);
}
