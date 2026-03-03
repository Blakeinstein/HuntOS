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
import type { MastraModelConfig } from '@mastra/core/llm';

// ---------------------------------------------------------------------------
// Env helpers — read at call time so tests can override process.env
// ---------------------------------------------------------------------------

function env(key: string): string | undefined {
	return process.env[key];
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
 * LMStudio — Mastra's built-in model router accepts the full prefixed string.
 * Optionally override the server URL via LMSTUDIO_BASE_URL.
 *
 * e.g. "lmstudio/qwen/qwen3-30b-a3b-2507"
 * With URL override: uses @ai-sdk/openai compat against the custom base URL.
 */
function resolveLMStudio(fullModelId: string): MastraModelConfig {
	const baseURL = env('LMSTUDIO_BASE_URL');
	const apiKey = env('LMSTUDIO_API_KEY') ?? 'lmstudio'; // LMStudio doesn't require a real key

	if (baseURL) {
		// When a custom base URL is set, use @ai-sdk/openai compat pointed at LMStudio's server
		const client = createOpenAI({ apiKey, baseURL });
		return client(fullModelId) as MastraModelConfig;
	}

	// Fall through to Mastra's model router string — passed through as-is
	return fullModelId as MastraModelConfig;
}

/**
 * GitHub Models — Mastra's built-in model router accepts the full prefixed string.
 * Optionally override the inference endpoint via GITHUB_MODELS_BASE_URL.
 *
 * e.g. "github-models/openai/gpt-4o"
 */
function resolveGitHubModels(fullModelId: string): MastraModelConfig {
	const baseURL = env('GITHUB_MODELS_BASE_URL');
	const token = requireEnv('GITHUB_TOKEN');

	if (baseURL) {
		// Custom base URL: use @ai-sdk/openai compat with GitHub token as API key
		const client = createOpenAI({ apiKey: token, baseURL });
		return client(fullModelId) as MastraModelConfig;
	}

	// Fall through to Mastra's model router string
	return fullModelId as MastraModelConfig;
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
	lmstudio: (_modelPath, fullModelId) => resolveLMStudio(fullModelId),
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
 * Returns a list of all supported provider prefixes.
 */
export function getSupportedProviders(): string[] {
	return Object.keys(PROVIDER_HANDLERS);
}
