import { LlmJson } from '@solvers-hub/llm-json';

/**
 * Extracts the first JSON object or array from a string that may contain
 * markdown fences, surrounding prose, <think>…</think> reasoning blocks,
 * or other non-JSON text produced by LLMs.
 *
 * Delegates to @solvers-hub/llm-json with attemptCorrection: true so that
 * common LLM JSON formatting mistakes (trailing commas, single quotes, etc.)
 * are automatically repaired before parsing.
 *
 * Falls back to a two-stage strategy (fast → correcting) for performance:
 *   Stage 1 – no correction (fast path)
 *   Stage 2 – with correction (fallback, only when stage 1 finds nothing)
 *
 * Returns `undefined` when no parseable JSON is found.
 */

const fastParser = new LlmJson({ attemptCorrection: false });
const correctingParser = new LlmJson({ attemptCorrection: true });

/**
 * Strip <think>…</think> blocks that reasoning models (e.g. Qwen, DeepSeek-R1)
 * emit before their actual response. These blocks frequently contain curly braces
 * that confuse naive brace-counting extractors.
 */
function stripThinkBlocks(text: string): string {
	return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

export function extractJson(text: string): unknown {
	const cleaned = stripThinkBlocks(text);

	// Stage 1: fast path — no correction
	const fast = fastParser.extract(cleaned);
	if (fast.json.length > 0) {
		// Prefer the largest JSON object found (most likely to be the result)
		return pickBestJson(fast.json);
	}

	// Stage 2: fallback with auto-correction
	const corrected = correctingParser.extract(cleaned);
	if (corrected.json.length > 0) {
		return pickBestJson(corrected.json);
	}

	return undefined;
}

/**
 * Given multiple extracted JSON values, prefer:
 *   1. The first plain object (most LLM results are objects)
 *   2. The first array
 *   3. The first value of any kind
 *
 * This avoids accidentally returning a small metadata object when the real
 * payload is a larger object later in the text.
 */
function pickBestJson(values: unknown[]): unknown {
	// Prefer objects over arrays/primitives; among objects prefer the one
	// with the most keys (most complete result).
	const objects = values.filter(
		(v) => v !== null && typeof v === 'object' && !Array.isArray(v)
	) as Record<string, unknown>[];

	if (objects.length > 0) {
		return objects.reduce((best, cur) =>
			Object.keys(cur).length >= Object.keys(best).length ? cur : best
		);
	}

	// Fall back to first array, then first value
	return values[0];
}
