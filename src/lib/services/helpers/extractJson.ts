/**
 * Extracts the first JSON object or array from a string that may contain
 * markdown fences, surrounding prose, or other non-JSON text.
 *
 * This is a shared utility used by any service that needs to parse
 * structured JSON from an LLM agent's free-form text response.
 *
 * Tries three strategies in order:
 *   1. Fenced code block (```json ... ``` or ``` ... ```)
 *   2. First `{` … last `}` substring (top-level object)
 *   3. First `[` … last `]` substring (top-level array)
 *
 * Returns `undefined` when no parseable JSON is found.
 */
export function extractJson(text: string): unknown {
	// 1. Try fenced code block
	const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
	if (fenceMatch) {
		try {
			return JSON.parse(fenceMatch[1].trim());
		} catch {
			// fall through
		}
	}

	// 2. Try outermost { … }
	const firstBrace = text.indexOf('{');
	const lastBrace = text.lastIndexOf('}');
	if (firstBrace !== -1 && lastBrace > firstBrace) {
		try {
			return JSON.parse(text.slice(firstBrace, lastBrace + 1));
		} catch {
			// fall through
		}
	}

	// 3. Try outermost [ … ]
	const firstBracket = text.indexOf('[');
	const lastBracket = text.lastIndexOf(']');
	if (firstBracket !== -1 && lastBracket > firstBracket) {
		try {
			return JSON.parse(text.slice(firstBracket, lastBracket + 1));
		} catch {
			// fall through
		}
	}

	return undefined;
}
