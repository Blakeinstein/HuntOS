// src/lib/mastra/tools/with-logging.ts
// Utility that wraps any Mastra tool with logging hooks for pre/post execution visibility.
//
// Supports an optional `onToolCall` callback so callers (e.g. the apply
// pipeline executor) can route tool-call events to an audit log, database,
// or any other sink without the tool needing direct access to those services.
//
// IMPORTANT: Mastra 1.4.0's `makeCoreTool()` / `CoreToolBuilder.build()` creates
// a NEW plain object for the AI SDK runtime, copying only specific properties
// (id, description, parameters, outputSchema, execute, etc.) from the original
// Tool instance. Any monkey-patched `onOutput` / `onInputAvailable` hooks are
// NOT copied to the CoreTool object and therefore never fire.
//
// The fix: wrap `execute` directly. Since `makeCoreTool` DOES copy the `execute`
// function (via `this.createExecute(this.originalTool, ...)` which calls the
// original tool's execute), wrapping `execute` on the Tool instance before
// registration ensures our wrapper survives the CoreTool conversion.
//
// This approach fires the callback on BOTH success and error, capturing the
// input, output, duration, and success status of every tool invocation.

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
	 *       agent_id: 'job-application-agent',
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
 * Monotonically increasing counter for generating unique tool call IDs
 * when no toolCallId is available from the runtime context.
 */
let callCounter = 0;

/**
 * Wraps a tool's `execute` function with logging and an optional callback.
 *
 * This is the PRIMARY mechanism for tool-call observability. We wrap `execute`
 * directly because Mastra 1.4.0's `makeCoreTool()` / `CoreToolBuilder.build()`
 * strips `onOutput` and `onInputAvailable` hooks when converting Tool instances
 * to CoreTool objects for the AI SDK. However, `execute` IS preserved through
 * the conversion (it's called by the CoreTool's own execute wrapper), so our
 * logging wrapper survives.
 *
 * The wrapper:
 * 1. Captures the input parameters and start time
 * 2. Calls the original execute function
 * 3. On success: logs the output and fires the onToolCall callback
 * 4. On error: logs the error and fires the onToolCall callback
 * 5. Re-throws any error so the agent sees it
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

	const originalExecute = t.execute;
	if (!originalExecute) {
		// Tool has no execute function — nothing to wrap
		return t as T;
	}

	const toolId: string = t.id ?? 'unknown-tool';

	// Wrap execute — this is the ONLY reliable hook that survives Mastra's
	// CoreTool conversion. Both success and error paths fire the callback.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	t.execute = async function (this: any, ...args: any[]) {
		const startTime = Date.now();
		const callId = `call-${toolId}-${++callCounter}`;

		// The first argument is the validated input object.
		// Mastra's CoreTool wraps the original execute and passes the validated
		// input as the first positional argument.
		const input =
			args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])
				? (args[0] as Record<string, unknown>)
				: {};

		logger.debug(`[tool:${toolId}] execute called`, {
			toolCallId: callId,
			input
		});

		try {
			const result = await originalExecute.apply(this, args);
			const durationMs = Date.now() - startTime;

			logger.debug(`[tool:${toolId}] execute completed`, {
				toolCallId: callId,
				output: result,
				durationMs
			});

			// Fire the audit callback on success
			if (options?.onToolCall) {
				try {
					options.onToolCall({
						toolId,
						toolCallId: callId,
						input,
						output: result as Record<string, unknown>,
						success: true,
						durationMs
					});
				} catch (callbackError) {
					logger.warn(`[tool:${toolId}] onToolCall success callback threw`, {
						error: callbackError
					});
				}
			}

			return result;
		} catch (error) {
			const durationMs = Date.now() - startTime;
			const errorMessage = error instanceof Error ? error.message : String(error);

			logger.debug(`[tool:${toolId}] execute failed`, {
				toolCallId: callId,
				error: errorMessage,
				durationMs
			});

			// Fire the audit callback on error
			if (options?.onToolCall) {
				try {
					options.onToolCall({
						toolId,
						toolCallId: callId,
						input,
						success: false,
						error: errorMessage,
						durationMs
					});
				} catch (callbackError) {
					logger.warn(`[tool:${toolId}] onToolCall error callback threw`, {
						error: callbackError
					});
				}
			}

			throw error;
		}
	};

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
