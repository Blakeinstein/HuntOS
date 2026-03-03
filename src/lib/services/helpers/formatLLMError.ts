// src/lib/services/helpers/formatLLMError.ts
// Unwraps AI SDK error chains into a human-readable string suitable for
// both server-side console logging and user-facing error messages.
//
// AI SDK errors nest their context like:
//   NoObjectGeneratedError
//     .cause → JSONParseError  (or TypeValidationError)
//       .cause → SyntaxError   (raw JSON parse failure)
//     .text   → the raw model output that failed to parse
//     .finishReason → "stop" | "length" | "error" | …
//
// A plain error.message call only surfaces the outermost message
// ("No object generated." / "Invalid JSON response") which gives no
// actionable information.  This helper walks the full chain.

// ── Helpers ──────────────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === 'object';
}

function getStr(obj: Record<string, unknown>, key: string): string | undefined {
	const v = obj[key];
	return typeof v === 'string' ? v : undefined;
}

function getNum(obj: Record<string, unknown>, key: string): number | undefined {
	const v = obj[key];
	return typeof v === 'number' ? v : undefined;
}

/** Truncate long strings so logs stay readable. */
function trunc(s: string, max = 500): string {
	return s.length > max ? s.slice(0, max) + `… [+${s.length - max} chars]` : s;
}

/** Recursively walk a cause chain and collect each message. */
function walkCause(cause: unknown, depth = 0): string[] {
	if (!cause || depth > 6) return [];
	if (!isObject(cause)) return [String(cause)];

	const lines: string[] = [];
	const msg =
		getStr(cause, 'message') ?? getStr(cause, 'msg') ?? cause.constructor?.name ?? 'UnknownError';
	const name = getStr(cause, 'name') ?? '';
	lines.push(name ? `${name}: ${msg}` : msg);

	// JSONParseError — show the text that failed to parse
	if (name === 'AI_JSONParseError' || name === 'JSONParseError') {
		const text = getStr(cause as Record<string, unknown>, 'text');
		if (text) lines.push(`  raw text: ${trunc(text)}`);
	}

	// TypeValidationError — show the value that failed validation
	if (name === 'AI_TypeValidationError' || name === 'TypeValidationError') {
		const value = (cause as Record<string, unknown>)['value'];
		if (value !== undefined) {
			try {
				lines.push(`  invalid value: ${trunc(JSON.stringify(value))}`);
			} catch {
				lines.push(`  invalid value: [not serialisable]`);
			}
		}
	}

	const nested = (cause as Record<string, unknown>)['cause'];
	if (nested) lines.push(...walkCause(nested, depth + 1));

	return lines;
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface FormattedLLMError {
	/** One-line summary suitable for a user-facing message or thrown Error. */
	summary: string;
	/** Multi-line detail string for server console output. */
	detail: string;
	/** The raw model output text, if the SDK attached it to the error. */
	rawText?: string;
	/** The finish reason reported by the model, if available. */
	finishReason?: string;
	/** Token usage, if the SDK attached it to the error. */
	usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

/**
 * Unwrap an AI SDK error (or any Error) into structured details for logging
 * and error reporting.
 *
 * @param err   The caught error value — may be anything.
 * @param label Short label prepended to the summary (e.g. "[TypstResume]").
 */
export function formatLLMError(err: unknown, label = '[LLM]'): FormattedLLMError {
	if (!isObject(err)) {
		const summary = `${label} Non-object error: ${String(err)}`;
		return { summary, detail: summary };
	}

	const name = getStr(err, 'name') ?? '';
	const message = getStr(err, 'message') ?? 'unknown error';

	// ── NoObjectGeneratedError ──────────────────────────────────
	const isNoObject =
		name === 'AI_NoObjectGeneratedError' ||
		name === 'NoObjectGeneratedError' ||
		message.includes('No object generated');

	const rawText = getStr(err, 'text');
	const finishReason = getStr(err, 'finishReason');
	const usageRaw = (err as Record<string, unknown>)['usage'];
	const usage = isObject(usageRaw)
		? {
				promptTokens: getNum(usageRaw, 'promptTokens'),
				completionTokens: getNum(usageRaw, 'completionTokens'),
				totalTokens: getNum(usageRaw, 'totalTokens')
			}
		: undefined;

	const responseRaw = (err as Record<string, unknown>)['response'];
	const modelId = isObject(responseRaw) ? getStr(responseRaw, 'modelId') : undefined;

	// Build summary line
	const parts: string[] = [`${label} ${name || 'Error'}: ${message}`];
	if (finishReason) parts.push(`finishReason=${finishReason}`);
	if (modelId) parts.push(`model=${modelId}`);
	if (usage?.totalTokens) parts.push(`tokens=${usage.totalTokens}`);
	const summary = parts.join(', ');

	// Build multi-line detail
	const detailLines: string[] = [summary];

	if (rawText) {
		detailLines.push(`  raw model output (first 800 chars):`);
		detailLines.push(`    ${trunc(rawText, 800).replace(/\n/g, '\n    ')}`);
	}

	// Walk the cause chain
	const cause = (err as Record<string, unknown>)['cause'];
	if (cause) {
		detailLines.push('  cause chain:');
		for (const line of walkCause(cause)) {
			detailLines.push(`    ${line}`);
		}
	}

	// Stack trace (only if it adds info beyond the cause chain)
	if (!isNoObject) {
		const stack = getStr(err, 'stack');
		if (stack) {
			const stackLines = stack.split('\n').slice(1, 6); // first 5 frames
			detailLines.push('  stack (top frames):');
			for (const line of stackLines) {
				detailLines.push(`    ${line.trim()}`);
			}
		}
	}

	return {
		summary,
		detail: detailLines.join('\n'),
		rawText,
		finishReason,
		usage
	};
}

/**
 * Log a rich error breakdown to the server console.
 * Always prints to stderr so it appears regardless of any log-level filters.
 *
 * @param err    The caught error value.
 * @param label  Short label shown in every line (e.g. "[TypstResume]").
 * @param extra  Any additional key/value context to print below the error.
 */
export function logLLMError(
	err: unknown,
	label: string,
	extra?: Record<string, unknown>
): FormattedLLMError {
	const formatted = formatLLMError(err, label);
	console.error('━'.repeat(72));
	console.error(formatted.detail);
	if (extra && Object.keys(extra).length > 0) {
		console.error(`  context: ${JSON.stringify(extra)}`);
	}
	console.error('━'.repeat(72));
	return formatted;
}
