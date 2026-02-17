// src/lib/mastra/tools/with-logging.ts
// Utility that wraps any Mastra tool with logging hooks for pre/post execution visibility

import type { Tool } from '@mastra/core/tools';
import { logger } from '../logger';

/**
 * Wraps a tool with `onInputAvailable` and `onOutput` lifecycle hooks that
 * log the incoming parameters and the resulting output via the shared PinoLogger.
 *
 * This is non-destructive — it preserves the original tool's config and only
 * layers logging on top. Any existing hooks are called after the logging hooks.
 *
 * We cast through `any` because the `Tool` generic has deeply nested type
 * parameters that make the constraint `T extends Tool` reject concrete tools.
 * At runtime the properties exist on every tool instance created via `createTool`.
 *
 * @example
 * ```ts
 * const logged = withToolLogging(myTool);
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withToolLogging<T extends Tool<any, any, any, any, any, any, any>>(tool: T): T {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const t = tool as any;

	const originalOnInputAvailable = t.onInputAvailable;
	const originalOnOutput = t.onOutput;

	// Attach pre-execution logging
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	t.onInputAvailable = (params: any) => {
		logger.debug(`[tool:${t.id}] input available`, {
			toolCallId: params.toolCallId,
			input: params.input
		});
		originalOnInputAvailable?.call(t, params);
	};

	// Attach post-execution logging
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	t.onOutput = (params: any) => {
		logger.debug(`[tool:${t.id}] output received`, {
			toolCallId: params.toolCallId,
			toolName: params.toolName,
			output: params.output
		});
		originalOnOutput?.call(t, params);
	};

	return t as T;
}

/**
 * Convenience helper — wraps every tool in a `Record<string, Tool>` with logging.
 *
 * @example
 * ```ts
 * import { browserTools } from './browser';
 * const logged = withToolLoggingAll(browserTools);
 * ```
 */
export function withToolLoggingAll<
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	T extends Record<string, Tool<any, any, any, any, any, any, any>>
>(tools: T): T {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const result = {} as Record<string, Tool<any, any, any, any, any, any, any>>;
	for (const [key, tool] of Object.entries(tools)) {
		result[key] = withToolLogging(tool);
	}
	return result as T;
}
