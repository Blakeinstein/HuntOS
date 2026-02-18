/**
 * Shared types for agent execution step events streamed via SSE.
 *
 * These types are used by both the server (SSE endpoint) and the
 * client (LiveScrapePanel) to ensure type-safe event communication.
 */

/**
 * Discriminated union of all step event types the server can emit.
 */
export type AgentStepEventType =
	| 'scrape-start'
	| 'tool-call'
	| 'tool-result'
	| 'tool-error'
	| 'text-delta'
	| 'step-start'
	| 'step-finish'
	| 'scrape-finish'
	| 'scrape-error';

/**
 * A single streamed event representing an agent execution step.
 *
 * Sent from the SSE endpoint as `data: <JSON>` lines.
 */
export interface AgentStepEvent {
	/** Discriminator for the event type. */
	type: AgentStepEventType;

	/** Monotonic timestamp (ms since epoch) when this event was emitted. */
	timestamp: number;

	/** Human-readable summary of what happened in this step. */
	message: string;

	/** Optional structured payload — shape varies by event type. */
	data?: AgentStepPayload;
}

/**
 * Union of all possible payloads keyed by event type.
 */
export type AgentStepPayload =
	| ScrapeStartPayload
	| ToolCallPayload
	| ToolResultPayload
	| ToolErrorPayload
	| TextDeltaPayload
	| StepStartPayload
	| StepFinishPayload
	| ScrapeFinishPayload
	| ScrapeErrorPayload;

// ── Per-event payloads ──────────────────────────────────────────────

export interface ScrapeStartPayload {
	kind: 'scrape-start';
	jobBoardId: number;
	jobBoardName: string;
	targetUrl: string;
	agentId: string;
	detectedBoard: string;
	runId?: string;
}

export interface ToolCallPayload {
	kind: 'tool-call';
	toolCallId: string;
	toolName: string;
	/** Stringified or structured tool input arguments. */
	args?: Record<string, unknown>;
}

export interface ToolResultPayload {
	kind: 'tool-result';
	toolCallId: string;
	toolName: string;
	/** Truncated string representation of the tool result. */
	result?: string;
	isError?: boolean;
}

export interface ToolErrorPayload {
	kind: 'tool-error';
	toolCallId: string;
	toolName: string;
	error: string;
}

export interface TextDeltaPayload {
	kind: 'text-delta';
	/** The incremental text chunk from the model. */
	text: string;
}

export interface StepStartPayload {
	kind: 'step-start';
	stepIndex: number;
}

export interface StepFinishPayload {
	kind: 'step-finish';
	stepIndex: number;
	finishReason?: string;
	/** Number of tool calls made in this step. */
	toolCallCount?: number;
	/** Token usage for this step. */
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
		totalTokens?: number;
	};
}

export interface ScrapeFinishPayload {
	kind: 'scrape-finish';
	success: boolean;
	totalFound: number;
	newApplications: number;
	duplicatesSkipped: number;
	errors: string[];
	blocked: boolean;
	/** The 1-based page number the agent finished scraping. */
	currentPage?: number;
	/** The full URL of the last page scraped (with pagination query params). */
	currentPageUrl?: string;
	/** Whether additional pages of results exist beyond the last page scraped. */
	hasMorePages?: boolean;
	/** Total duration of the scrape in milliseconds. */
	durationMs: number;
}

export interface ScrapeErrorPayload {
	kind: 'scrape-error';
	error: string;
	/** Total duration before the error occurred. */
	durationMs: number;
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Create a well-formed `AgentStepEvent` with auto-timestamped `timestamp`.
 */
export function createStepEvent(
	type: AgentStepEventType,
	message: string,
	data?: AgentStepPayload
): AgentStepEvent {
	return {
		type,
		timestamp: Date.now(),
		message,
		...(data !== undefined ? { data } : {})
	};
}

/**
 * Friendly label map for tool IDs → human-readable names.
 * Used by the SSE emitter to produce nicer `message` strings.
 */
export const TOOL_LABELS: Record<string, string> = {
	'browser-open': 'Navigate to URL',
	'browser-back': 'Go back',
	'browser-forward': 'Go forward',
	'browser-reload': 'Reload page',
	'browser-close': 'Close browser',
	'browser-snapshot': 'Take page snapshot',
	'browser-screenshot': 'Take screenshot',
	'browser-get-title': 'Get page title',
	'browser-get-url': 'Get current URL',
	'browser-scroll': 'Scroll page',
	'browser-click': 'Click element',
	'browser-dblclick': 'Double-click element',
	'browser-fill': 'Fill input',
	'browser-type': 'Type text',
	'browser-press': 'Press key',
	'browser-hover': 'Hover element',
	'browser-select': 'Select option',
	'browser-check': 'Check checkbox',
	'browser-uncheck': 'Uncheck checkbox',
	'browser-get-text': 'Get element text',
	'browser-get-html': 'Get element HTML',
	'browser-get-value': 'Get input value',
	'browser-get-attribute': 'Get attribute',
	'browser-get-count': 'Count elements',
	'browser-get-bounding-box': 'Get bounding box',
	'browser-is-visible': 'Check visibility',
	'browser-is-enabled': 'Check enabled state',
	'browser-is-checked': 'Check checked state',
	'browser-eval-js': 'Execute JavaScript',
	'browser-wait-for-selector': 'Wait for selector',
	'browser-wait-for-time': 'Wait (timed)',
	'browser-wait-for-text': 'Wait for text',
	'browser-wait-for-url': 'Wait for URL',
	'browser-wait-for-load': 'Wait for page load',
	'browser-wait-for-condition': 'Wait for condition',
	'browser-find-by-role': 'Find by ARIA role',
	'browser-find-by-text': 'Find by text',
	'browser-find-by-label': 'Find by label',
	'browser-find-by-placeholder': 'Find by placeholder',
	'browser-find-by-test-id': 'Find by test ID',
	'browser-find-first': 'Find first match',
	'browser-find-nth': 'Find nth match',
	'browser-list-tabs': 'List tabs',
	'browser-new-tab': 'Open new tab',
	'browser-switch-tab': 'Switch tab',
	'browser-close-tab': 'Close tab',
	'browser-switch-to-frame': 'Switch to iframe',
	'browser-switch-to-main-frame': 'Switch to main frame'
};

/**
 * Get a friendly label for a tool name, falling back to the raw ID.
 */
export function getToolLabel(toolName: string): string {
	return TOOL_LABELS[toolName] ?? toolName;
}

/**
 * Truncate a string to a maximum length, appending '…' if truncated.
 */
export function truncate(str: string, maxLen: number = 200): string {
	if (str.length <= maxLen) return str;
	return str.slice(0, maxLen) + '…';
}
