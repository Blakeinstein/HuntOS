// src/lib/utils/boolean.ts
/**
 * Shared utility functions for handling boolean conversions, especially from LLM-generated JSON.
 * LLMs often output string representations of booleans like "True", "False", "yes", "no", etc.
 */

/**
 * Coerce common LLM string representations of booleans into actual booleans.
 * Handles: "true"/"false", "True"/"False", "yes"/"no", "1"/"0", etc.
 *
 * @param value - The value to coerce (can be boolean, string, or undefined)
 * @returns The coerced boolean value (defaults to false for undefined/invalid inputs)
 */
export function coerceBoolean(value: boolean | string | undefined): boolean {
	if (typeof value === 'boolean') return value;
	if (value === undefined) return false;

	const str = String(value).toLowerCase().trim();
	return ['true', 'yes', 'y', '1'].includes(str);
}

/**
 * Parse a string that might be a boolean representation.
 * Returns null if the input is not a recognizable boolean-like string.
 *
 * @param value - The string to parse
 * @returns Boolean parsed from the string, or null if unrecognizable
 */
export function tryParseBoolean(value: string): boolean | null {
	const str = String(value).toLowerCase().trim();

	if (str === 'true' || str === 'yes' || str === 'y' || str === '1') return true;
	if (str === 'false' || str === 'no' || str === 'n' || str === '0') return false;

	return null;
}
