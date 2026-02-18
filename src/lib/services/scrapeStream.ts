/**
 * Client-side scrape stream helper using native EventSource (proper SSE).
 *
 * Flow:
 *   1. POST /api/job-boards/:id/scrape-stream  → triggers the scrape, returns { runId }
 *   2. GET  /api/job-boards/:id/scrape-stream  → EventSource SSE stream with named events
 *
 * The server buffers events and supports Last-Event-ID replay, so late-joining
 * clients (e.g. navigating to the audit page mid-scrape) automatically catch up.
 *
 * Both ScrapeButton and LiveScrapePanel use this shared helper.
 */

import { registerScrape, type ScrapeStreamHandle } from '$lib/stores/activeScrapes';
import type {
	AgentStepEvent,
	AgentStepEventType,
	ScrapeFinishPayload,
	ScrapeErrorPayload
} from '$lib/services/services/agentStream.types';

// ── Public API ──────────────────────────────────────────────────────

export interface ScrapeStreamOptions {
	/** Job board database ID. */
	boardId: number;
	/** Human-readable board name (for display). */
	boardName: string;
	/** Called for every event received from the SSE stream. */
	onEvent?: (event: AgentStepEvent) => void;
	/** Called when the scrape finishes successfully (or with warnings). */
	onFinish?: (payload: ScrapeFinishPayload) => void;
	/** Called when the scrape errors out. */
	onError?: (payload: ScrapeErrorPayload) => void;
	/** Called when the HTTP POST to trigger the scrape fails. */
	onTriggerError?: (status: number, message: string) => void;
	/** Called when the EventSource connection errors. */
	onConnectionError?: (error: string) => void;
}

export interface ScrapeStreamController {
	/** The handle for the active scrape (for direct state access). */
	handle: ScrapeStreamHandle;
	/** Abort the stream and close the EventSource. */
	abort: () => void;
	/** Promise that resolves when the stream finishes or errors. */
	done: Promise<void>;
}

/**
 * Trigger a scrape and open an EventSource to stream events.
 *
 * Registers the scrape in the global `activeScrapes` store so it can
 * be observed from any page (audit, job boards, etc.).
 */
export function startScrapeStream(options: ScrapeStreamOptions): ScrapeStreamController {
	const { boardId, boardName } = options;

	const handle = registerScrape(boardId, boardName);

	const done = triggerAndStream(handle, options);

	return {
		handle,
		abort: () => handle.abort(),
		done
	};
}

// ── All SSE event types we listen for ───────────────────────────────

const SSE_EVENT_TYPES: AgentStepEventType[] = [
	'scrape-start',
	'tool-call',
	'tool-result',
	'tool-error',
	'text-delta',
	'step-start',
	'step-finish',
	'scrape-finish',
	'scrape-error'
];

// ── Internal implementation ─────────────────────────────────────────

async function triggerAndStream(
	handle: ScrapeStreamHandle,
	options: ScrapeStreamOptions
): Promise<void> {
	const { boardId } = options;
	const startTime = Date.now();

	// ── Step 1: POST to trigger the scrape ──────────────────────────

	try {
		const response = await fetch(`/api/job-boards/${boardId}/scrape-stream`, {
			method: 'POST',
			signal: handle.signal
		});

		if (!response.ok) {
			const body = await response.text();
			let errorMsg: string;
			try {
				errorMsg = JSON.parse(body).error ?? body;
			} catch {
				errorMsg = body;
			}

			const errorPayload: ScrapeErrorPayload = {
				kind: 'scrape-error',
				error: `HTTP ${response.status}: ${errorMsg}`,
				durationMs: 0
			};

			const errorEvent: AgentStepEvent = {
				type: 'scrape-error',
				timestamp: Date.now(),
				message: `Failed to start scrape: ${errorMsg}`,
				data: errorPayload
			};

			handle.pushEvent(errorEvent);
			options.onEvent?.(errorEvent);
			handle.error(errorPayload);
			options.onTriggerError?.(response.status, errorMsg);
			return;
		}

		// POST succeeded — the scrape is now running on the server
		handle.markStreaming();
	} catch (err) {
		if (handle.signal.aborted) return;

		const message = err instanceof Error ? err.message : String(err);
		const errorPayload: ScrapeErrorPayload = {
			kind: 'scrape-error',
			error: `Connection error: ${message}`,
			durationMs: Date.now() - startTime
		};

		const errorEvent: AgentStepEvent = {
			type: 'scrape-error',
			timestamp: Date.now(),
			message: `Connection error: ${message}`,
			data: errorPayload
		};

		handle.pushEvent(errorEvent);
		options.onEvent?.(errorEvent);
		handle.error(errorPayload);
		options.onConnectionError?.(message);
		return;
	}

	// ── Step 2: Open EventSource to receive SSE events ──────────────

	return new Promise<void>((resolve) => {
		if (handle.signal.aborted) {
			resolve();
			return;
		}

		const url = `/api/job-boards/${boardId}/scrape-stream`;
		const eventSource = new EventSource(url);

		let resolved = false;

		function finish() {
			if (resolved) return;
			resolved = true;
			eventSource.close();
			resolve();
		}

		// Handle abort from the outside (user clicked Stop)
		handle.signal.addEventListener('abort', () => {
			eventSource.close();
			finish();
		});

		// Register a listener for each named SSE event type
		for (const eventType of SSE_EVENT_TYPES) {
			eventSource.addEventListener(eventType, ((sseEvent: MessageEvent) => {
				let event: AgentStepEvent;
				try {
					event = JSON.parse(sseEvent.data) as AgentStepEvent;
				} catch {
					return; // skip malformed events
				}

				handle.pushEvent(event);
				options.onEvent?.(event);

				if (eventType === 'scrape-finish') {
					const payload = event.data as ScrapeFinishPayload;
					handle.finish(payload);
					options.onFinish?.(payload);
					finish();
				} else if (eventType === 'scrape-error') {
					const payload = event.data as ScrapeErrorPayload;
					handle.error(payload);
					options.onError?.(payload);
					finish();
				}
			}) as EventListener);
		}

		// Handle EventSource-level errors (connection failures, server close)
		eventSource.onerror = () => {
			// EventSource fires onerror both for recoverable issues (it reconnects)
			// and for fatal ones (readyState === CLOSED). Only treat CLOSED as fatal.
			if (eventSource.readyState === EventSource.CLOSED) {
				// The connection was closed. If we already received a terminal event,
				// we've already called finish(). Otherwise, synthesize an error.
				if (!resolved) {
					const durationMs = Date.now() - startTime;

					const syntheticPayload: ScrapeErrorPayload = {
						kind: 'scrape-error',
						error: 'Stream connection closed unexpectedly',
						durationMs
					};

					const syntheticEvent: AgentStepEvent = {
						type: 'scrape-error',
						timestamp: Date.now(),
						message: 'Stream connection closed unexpectedly',
						data: syntheticPayload
					};

					handle.pushEvent(syntheticEvent);
					options.onEvent?.(syntheticEvent);
					handle.error(syntheticPayload);
					options.onConnectionError?.('Stream connection closed unexpectedly');
					finish();
				}
			}
			// If readyState is CONNECTING, EventSource is auto-reconnecting.
			// The server supports Last-Event-ID replay, so we just let it reconnect.
		};
	});
}
