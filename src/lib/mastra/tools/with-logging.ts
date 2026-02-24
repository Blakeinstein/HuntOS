// src/lib/mastra/tools/with-logging.ts
// Utility that wraps any Mastra tool with logging hooks for pre/post execution visibility.
//
// Supports an optional `onToolCall` callback so callers (e.g. the apply
// pipeline executor) can route tool-call events to an audit log, database,
// or any other sink without the tool needing direct access to those services.

import type { Tool } from '@mastra/core/tools';
import { logger } from '../logger';

/**
 * Payload delivered to the optional `onToolCall` callback after a tool
 * finishes executing (successfully or not).
 */
export interface ToolCallEvent {
	/** The Mastra tool ID (e.g. `browser-click`, `browser-fill`). */
	toolId: string;
	/** The unique ID of this particular tool invocation. */
	toolCallId: string;
	/** The input parameters that were passed to the tool. */
	input: Record<string, unknown>;
	/** The output returned by the tool (may be `undefined` if it threw). */
	output?: Record<string, unknown>;
	/** Whether the tool executed without throwing. */
	success: boolean;
	/** If the tool threw, the error message. */
	error?: string;
	/** Wall-clock duration of the tool execution in milliseconds. */
	durationMs: number;
}

/**
 * Options accepted by both {@link withToolLogging} and {@link withToolLoggingAll}.
 */
export interface ToolLoggingOptions {
	/**
	 * Optional callback invoked after every tool execution with a summary
	 * of the call. Use this to integrate tool-level audit logging without
	 * coupling tool code to the audit service.
	 *
	 * @example
	 * ```ts
	 * const tools = withToolLoggingAll(browserTools, {
	 *   onToolCall: (evt) => {
	 *     auditLogService.create({
	 *       category: 'browser',
	 *       agent_id: 'job-application-agent.linkedin',
	 *       status: evt.success ? 'success' : 'error',
	 *       title: `Tool: ${evt.toolId}`,
	 *       detail: evt.success
	 *         ? JSON.stringify(evt.output)
	 *         : evt.error,
	 *       duration_ms: evt.durationMs,
	 *       meta: { input: evt.input },
	 *     });
	 *   },
	 * });
	 * ```
	 */
	onToolCall?: (event: ToolCallEvent) => void;
}

/**
 * Wraps a tool with `onInputAvailable` and `onOutput` lifecycle hooks that
 * log the incoming parameters and the resulting output via the shared PinoLogger.
 *
 * When an `onToolCall` callback is provided, it is invoked after each tool
 * execution with a {@link ToolCallEvent} payload that includes the tool ID,
 * input, output, success flag, and duration.
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
 * const audited = withToolLogging(myTool, { onToolCall: (evt) => console.log(evt) });
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withToolLogging<T extends Tool<any, any, any, any, any, any, any>>(
	tool: T,
	options?: ToolLoggingOptions
): T {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const t = tool as any;

	const originalOnInputAvailable = t.onInputAvailable;
	const originalOnOutput = t.onOutput;
	const originalExecute = t.execute;

	// Per-call timing map: toolCallId → startTime
	const callTimings = new Map<string, number>();

	// Attach pre-execution logging
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	t.onInputAvailable = (params: any) => {
		const toolCallId = params.toolCallId ?? 'unknown';
		callTimings.set(toolCallId, Date.now());

		logger.debug(`[tool:${t.id}] input available`, {
			toolCallId,
			input: params.input
		});
		originalOnInputAvailable?.call(t, params);
	};

	// Attach post-execution logging
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	t.onOutput = (params: any) => {
		const toolCallId = params.toolCallId ?? 'unknown';
		const startTime = callTimings.get(toolCallId);
		const durationMs = startTime ? Date.now() - startTime : 0;
		callTimings.delete(toolCallId);

		logger.debug(`[tool:${t.id}] output received`, {
			toolCallId,
			toolName: params.toolName,
			output: params.output,
			durationMs
		});

		// Fire the audit callback if provided
		if (options?.onToolCall) {
			try {
				options.onToolCall({
					toolId: t.id,
					toolCallId,
					input: params.input ?? {},
					output: params.output,
					success: true,
					durationMs
				});
			} catch (callbackError) {
				logger.warn(`[tool:${t.id}] onToolCall callback threw`, { error: callbackError });
			}
		}

		originalOnOutput?.call(t, params);
	};

	// If onToolCall is provided, also wrap `execute` to catch errors that
	// don't trigger `onOutput` (e.g. when the tool throws before returning).
	if (options?.onToolCall && originalExecute) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		t.execute = async function (this: any, ...args: any[]) {
			const startTime = Date.now();
			// The first argument is typically the input object
			const input = args[0] ?? {};
			try {
				const result = await originalExecute.apply(this, args);
				return result;
			} catch (error) {
				const durationMs = Date.now() - startTime;
				const errorMessage = error instanceof Error ? error.message : String(error);

				try {
					options.onToolCall!({
						toolId: t.id,
						toolCallId: 'error-' + Date.now(),
						input: typeof input === 'object' ? input : {},
						success: false,
						error: errorMessage,
						durationMs
					});
				} catch (callbackError) {
					logger.warn(`[tool:${t.id}] onToolCall error callback threw`, {
						error: callbackError
					});
				}

				throw error;
			}
		};
	}

	return t as T;
}

/**
 * Convenience helper — wraps every tool in a `Record<string, Tool>` with logging.
 *
 * When `options.onToolCall` is provided, every tool call across the entire
 * tool set will fire the callback with a {@link ToolCallEvent}.
 *
 * @example
 * ```ts
 * import { browserTools } from './browser';
 *
 * // Basic Pino-only logging
 * const logged = withToolLoggingAll(browserTools);
 *
 * // With audit callback
 * const audited = withToolLoggingAll(browserTools, {
 *   onToolCall: (evt) => {
 *     auditLogService.create({ ... });
 *   },
 * });
 * ```
 */
export function withToolLoggingAll<
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	T extends Record<string, Tool<any, any, any, any, any, any, any>>
>(tools: T, options?: ToolLoggingOptions): T {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const result = {} as Record<string, Tool<any, any, any, any, any, any, any>>;
	for (const [key, tool] of Object.entries(tools)) {
		result[key] = withToolLogging(tool, options);
	}
	return result as T;
}
