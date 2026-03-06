/**
 * Agent Continuation Loop
 *
 * Re-invokes an LLM agent when it stops mid-task without producing a
 * structured JSON result. This solves a common problem with agentic
 * browser automation: the model does useful work (navigates, fills
 * fields, clicks buttons) but then hits its natural completion boundary
 * before outputting the final structured result.
 *
 * The loop feeds the conversation history back to the agent with a
 * continuation prompt, allowing it to pick up where it left off.
 *
 * Safety guards:
 *   - Max iteration cap (default 5) to prevent infinite loops
 *   - Total step budget across all iterations (default 80)
 *   - Stall detection: if the agent produces no tool calls in an
 *     iteration, it's likely stuck — force a final JSON-output attempt
 *   - Cancellation callback for cooperative abort
 */

import type { Agent } from '@mastra/core/agent';
import type { RequestContext } from '@mastra/core/request-context';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRequestContext = RequestContext<any>;
import type { ZodSchema } from 'zod';
import { extractJson } from './extractJson';

// ── Types ───────────────────────────────────────────────────────────

export interface ContinuationLoopOptions<T> {
	/** The Mastra agent instance to invoke */
	agent: Agent;

	/** Initial user message for the first iteration */
	initialMessage: string;

	/** Request context passed to every generate() call */
	requestContext: AnyRequestContext;

	/** Zod schema to validate the parsed JSON result */
	schema: ZodSchema<T>;

	/**
	 * Max steps per individual generate() call.
	 * @default 30
	 */
	maxStepsPerIteration?: number;

	/**
	 * Max total steps summed across all iterations.
	 * Once exceeded, the loop forces a final JSON-output attempt.
	 * @default 80
	 */
	totalStepBudget?: number;

	/**
	 * Max number of generate() calls (iterations).
	 * @default 5
	 */
	maxIterations?: number;

	/**
	 * Called before each iteration. Throw (e.g. CancellationError) to abort.
	 */
	onBeforeIteration?: (iteration: number, totalStepsSoFar: number) => void | Promise<void>;

	/**
	 * Called after each iteration with summary info for logging.
	 */
	onIterationComplete?: (info: IterationInfo) => void | Promise<void>;
}

export interface IterationInfo {
	iteration: number;
	stepsThisIteration: number;
	toolCallsThisIteration: number;
	totalStepsSoFar: number;
	textLength: number;
	/** Whether valid JSON was found in this iteration's text */
	foundJson: boolean;
	/** Whether schema validation passed */
	schemaValid: boolean;
	/** Whether this was a forced final attempt */
	wasFinalAttempt: boolean;
	/**
	 * The agent's non-JSON text output for this iteration.
	 * When the agent hasn't produced a JSON result yet, this contains
	 * its natural-language commentary about what it's doing / where it is.
	 * Empty string when the text was valid JSON (nothing extra to show).
	 */
	agentText: string;
	/**
	 * Combined reasoning text from the model for this iteration, if the
	 * model supports extended thinking / chain-of-thought.
	 * `undefined` when the model didn't produce reasoning output.
	 */
	reasoningText: string | undefined;
}

export interface ContinuationLoopResult<T> {
	/** The validated structured result, or null if all iterations failed */
	result: T | null;

	/** Total iterations executed */
	iterations: number;

	/** Total steps across all iterations */
	totalSteps: number;

	/** Total tool calls across all iterations */
	totalToolCalls: number;

	/**
	 * The raw text from the last iteration (useful for error messages).
	 */
	lastText: string;

	/**
	 * If schema validation failed, the issues string.
	 */
	validationError?: string;

	/**
	 * True when the loop ran out of iterations or step budget without ever
	 * producing a valid structured result. Distinct from a result of null
	 * caused by an early cancellation or thrown error — this specifically
	 * means the agent kept working but never finished.
	 */
	exhausted?: boolean;
}

// ── Prompts ─────────────────────────────────────────────────────────

const CONTINUE_PROMPT =
	`You stopped before completing the task. The browser session is still active ` +
	`and your previous actions have been preserved. Continue where you left off — ` +
	`take a browser-snapshot to see the current page state, then proceed with ` +
	`filling and submitting the application form. ` +
	`When you are completely done, return your final JSON result.`;

const FINAL_ATTEMPT_PROMPT =
	`You have been working on this task across multiple attempts. ` +
	`You MUST now return your final result as a JSON object. ` +
	`If you have already submitted the application, report success. ` +
	`If you encountered issues, report the current state accurately. ` +
	`Take a browser-snapshot first to see the current page state if needed, ` +
	`then return the JSON result. Do NOT perform any more form-filling actions — ` +
	`just observe and report.`;

// ── Implementation ──────────────────────────────────────────────────

export async function runAgentContinuationLoop<T>(
	options: ContinuationLoopOptions<T>
): Promise<ContinuationLoopResult<T>> {
	const {
		agent,
		initialMessage,
		requestContext,
		schema,
		maxStepsPerIteration = 30,
		totalStepBudget = 80,
		maxIterations = 5,
		onBeforeIteration,
		onIterationComplete
	} = options;

	let totalSteps = 0;
	let totalToolCalls = 0;
	let lastText = '';
	let validationError: string | undefined;
	let consecutiveStalls = 0;

	// Accumulate conversation history across iterations.
	// On the first call we send the initial user message as a string.
	// On subsequent calls we send the full message history + a continuation prompt.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let conversationMessages: any[] | null = null;

	for (let iteration = 1; iteration <= maxIterations; iteration++) {
		// ── Pre-iteration hook (cancellation check, logging, etc.) ──
		if (onBeforeIteration) {
			await onBeforeIteration(iteration, totalSteps);
		}

		const budgetRemaining = totalStepBudget - totalSteps;
		if (budgetRemaining <= 0) {
			// Budget exhausted — break out and return what we have
			break;
		}

		// Determine if this is the forced final attempt.
		// Also triggers if the agent has stalled (no tool calls, no JSON) twice in a row.
		const isFinalAttempt =
			iteration === maxIterations ||
			budgetRemaining <= maxStepsPerIteration * 0.4 ||
			consecutiveStalls >= 2;

		const stepsThisIteration = Math.min(maxStepsPerIteration, budgetRemaining);

		// ── Build the message input ─────────────────────────────────
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let messageInput: any;

		if (iteration === 1) {
			// First iteration: just the initial user message
			messageInput = initialMessage;
		} else if (conversationMessages) {
			// Subsequent iterations: full conversation history + continuation prompt
			const continuationPrompt = isFinalAttempt ? FINAL_ATTEMPT_PROMPT : CONTINUE_PROMPT;
			messageInput = [
				...conversationMessages,
				{
					role: 'user' as const,
					content: continuationPrompt
				}
			];
		} else {
			// Shouldn't happen, but fallback
			messageInput = initialMessage;
		}

		// ── Call the agent ───────────────────────────────────────────
		const agentResult = await agent.generate(messageInput, {
			requestContext,
			maxSteps: stepsThisIteration
		});

		// ── Collect metrics ──────────────────────────────────────────
		const stepsUsed = agentResult.steps?.length ?? 0;
		const toolCallsUsed = agentResult.toolCalls?.length ?? 0;
		const agentText = agentResult.text ?? '';

		totalSteps += stepsUsed;
		totalToolCalls += toolCallsUsed;
		lastText = agentText;

		// Save conversation for potential continuation.
		// `messages` contains the full conversation including system, user,
		// assistant, and tool messages from this and all prior turns.
		conversationMessages = agentResult.messages ?? null;

		// ── Try to parse a structured result ─────────────────────────
		const raw = extractJson(agentText);
		const foundJson = raw !== undefined;
		let schemaValid = false;
		let result: T | null = null;

		if (foundJson) {
			const normalized = Array.isArray(raw) && raw.length > 0 ? raw[0] : raw;
			const parsed = schema.safeParse(normalized);

			if (parsed.success) {
				schemaValid = true;
				result = parsed.data;
			} else {
				validationError = parsed.error.issues
					.map((i) => `${String(i.path.join('.'))}: ${i.message}`)
					.join('; ');
			}
		}

		// ── Notify caller ────────────────────────────────────────────
		if (onIterationComplete) {
			// Strip the JSON blob from the text so callers get only the
			// natural-language commentary (what the agent is doing / where it is).
			const strippedText = foundJson ? '' : agentText.trim();

			await onIterationComplete({
				iteration,
				stepsThisIteration: stepsUsed,
				toolCallsThisIteration: toolCallsUsed,
				totalStepsSoFar: totalSteps,
				textLength: agentText.length,
				foundJson,
				schemaValid,
				wasFinalAttempt: isFinalAttempt,
				agentText: strippedText,
				reasoningText: agentResult.reasoningText ?? undefined
			});
		}

		// ── Success — we got a valid result ──────────────────────────
		if (result !== null) {
			return {
				result,
				iterations: iteration,
				totalSteps,
				totalToolCalls,
				lastText: agentText
			};
		}

		// ── Stall detection ──────────────────────────────────────────
		// If the agent made no tool calls AND produced no valid JSON,
		// it's likely stuck in a text-only loop. Track consecutive stalls
		// so the isFinalAttempt flag triggers after 2 in a row.
		if (toolCallsUsed === 0 && !foundJson) {
			consecutiveStalls++;
		} else {
			consecutiveStalls = 0;
		}

		// If this was the final attempt and we still don't have valid JSON, break
		if (isFinalAttempt) {
			break;
		}
	}

	// ── All iterations exhausted without a valid result ──────────────
	return {
		result: null,
		iterations: maxIterations,
		totalSteps,
		totalToolCalls,
		lastText,
		validationError,
		exhausted: true
	};
}
