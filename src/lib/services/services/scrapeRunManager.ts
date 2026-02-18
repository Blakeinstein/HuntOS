/**
 * Server-side in-memory manager for active scrape runs.
 *
 * When a scrape is triggered (POST /api/job-boards/:id/scrape), the run
 * is registered here. SSE subscribers (GET /api/job-boards/:id/scrape/stream)
 * attach to a run and receive events in real time via callbacks.
 *
 * Events are buffered so that late-joining SSE clients can replay history.
 * Completed runs are kept for a short retention period so clients that
 * connect just after a run finishes can still see the result.
 */

import type {
	AgentStepEvent,
	AgentStepEventType,
	ScrapeFinishPayload,
	ScrapeErrorPayload
} from '$lib/services/services/agentStream.types';

// ── Types ───────────────────────────────────────────────────────────

export type RunState = 'pending' | 'streaming' | 'done' | 'error';

export interface ScrapeRun {
	/** Unique run identifier. */
	runId: string;
	/** Job board database ID this run belongs to. */
	boardId: number;
	/** Human-readable board name. */
	boardName: string;
	/** Current state of the run. */
	state: RunState;
	/** Monotonically increasing event ID (1-based). Used for SSE `id:` field. */
	lastEventId: number;
	/** All events emitted so far (buffered for late-joining subscribers). */
	events: AgentStepEvent[];
	/** Terminal finish payload, if the run completed. */
	finishPayload: ScrapeFinishPayload | null;
	/** Terminal error payload, if the run errored. */
	errorPayload: ScrapeErrorPayload | null;
	/** Epoch ms when the run was created. */
	createdAt: number;
	/** Epoch ms when the run reached a terminal state (null if still running). */
	completedAt: number | null;
}

/** Callback signature for SSE subscribers. */
export type SseSubscriber = (eventId: number, eventType: AgentStepEventType, event: AgentStepEvent) => void;

/** Callback invoked when a run reaches a terminal state. */
export type RunFinishCallback = (run: ScrapeRun) => void;

// ── Constants ───────────────────────────────────────────────────────

/** How long (ms) to keep completed runs before garbage-collecting them. */
const COMPLETED_RUN_RETENTION_MS = 5 * 60 * 1000; // 5 minutes

/** Interval (ms) between GC sweeps. */
const GC_INTERVAL_MS = 60 * 1000; // 1 minute

// ── Run Manager ─────────────────────────────────────────────────────

class ScrapeRunManager {
	/** Active and recently-completed runs keyed by boardId. */
	private runs = new Map<number, ScrapeRun>();

	/** SSE subscriber sets keyed by boardId. */
	private subscribers = new Map<number, Set<SseSubscriber>>();

	/** Global finish listeners (e.g. for audit log refresh). */
	private finishListeners = new Set<RunFinishCallback>();

	/** GC timer handle. */
	private gcTimer: ReturnType<typeof setInterval> | null = null;

	constructor() {
		// Start periodic GC
		this.gcTimer = setInterval(() => this.gc(), GC_INTERVAL_MS);
		// Prevent the timer from keeping the process alive
		if (this.gcTimer && typeof this.gcTimer === 'object' && 'unref' in this.gcTimer) {
			this.gcTimer.unref();
		}
	}

	// ── Run lifecycle ─────────────────────────────────────────────

	/**
	 * Create a new scrape run for a board.
	 * If a run already exists for this board and is still active, it is replaced.
	 */
	createRun(boardId: number, boardName: string): ScrapeRun {
		const existing = this.runs.get(boardId);
		if (existing && (existing.state === 'pending' || existing.state === 'streaming')) {
			// Notify existing subscribers that the old run was cancelled
			this.emit(boardId, 'scrape-error', {
				type: 'scrape-error',
				timestamp: Date.now(),
				message: 'Run cancelled — a new run was started',
				data: {
					kind: 'scrape-error',
					error: 'Run cancelled — a new run was started',
					durationMs: Date.now() - existing.createdAt
				}
			});
		}

		const run: ScrapeRun = {
			runId: generateRunId(),
			boardId,
			boardName,
			state: 'pending',
			lastEventId: 0,
			events: [],
			finishPayload: null,
			errorPayload: null,
			createdAt: Date.now(),
			completedAt: null
		};

		this.runs.set(boardId, run);
		return run;
	}

	/**
	 * Get the current run for a board (if any).
	 */
	getRun(boardId: number): ScrapeRun | undefined {
		return this.runs.get(boardId);
	}

	/**
	 * Get all active (non-terminal) runs.
	 */
	getActiveRuns(): ScrapeRun[] {
		return Array.from(this.runs.values()).filter(
			(r) => r.state === 'pending' || r.state === 'streaming'
		);
	}

	/**
	 * Check whether a board currently has an active run.
	 */
	isRunning(boardId: number): boolean {
		const run = this.runs.get(boardId);
		return run != null && (run.state === 'pending' || run.state === 'streaming');
	}

	// ── Event emission ────────────────────────────────────────────

	/**
	 * Push an event into the run's buffer and fan out to all SSE subscribers.
	 *
	 * Call this from the scrape execution loop on the server whenever the
	 * agent produces a new stream chunk.
	 */
	pushEvent(boardId: number, eventType: AgentStepEventType, event: AgentStepEvent): void {
		const run = this.runs.get(boardId);
		if (!run) return;

		// Transition to streaming on first non-start event
		if (run.state === 'pending' && eventType !== 'scrape-start') {
			run.state = 'streaming';
		} else if (run.state === 'pending' && eventType === 'scrape-start') {
			run.state = 'streaming';
		}

		run.lastEventId++;
		run.events.push(event);

		// Handle terminal events
		if (eventType === 'scrape-finish') {
			run.state = 'done';
			run.finishPayload = (event.data as ScrapeFinishPayload) ?? null;
			run.completedAt = Date.now();
			this.notifyFinish(run);
		} else if (eventType === 'scrape-error') {
			run.state = 'error';
			run.errorPayload = (event.data as ScrapeErrorPayload) ?? null;
			run.completedAt = Date.now();
			this.notifyFinish(run);
		}

		// Fan out to subscribers
		this.emit(boardId, eventType, event);
	}

	// ── SSE subscription ──────────────────────────────────────────

	/**
	 * Subscribe to events for a given board's run.
	 *
	 * Returns:
	 * - `replay`: array of `[eventId, event]` tuples for events the client
	 *   missed (based on `lastEventId`). Empty if no events were missed.
	 * - `unsubscribe`: call to remove the subscriber.
	 * - `run`: the current run (or undefined if none exists).
	 *
	 * If `lastEventId` is provided (from the SSE `Last-Event-ID` header),
	 * only events after that ID are included in the replay.
	 */
	subscribe(
		boardId: number,
		callback: SseSubscriber,
		lastEventId?: number
	): {
		replay: Array<{ eventId: number; eventType: AgentStepEventType; event: AgentStepEvent }>;
		unsubscribe: () => void;
		run: ScrapeRun | undefined;
	} {
		// Register the subscriber
		let subs = this.subscribers.get(boardId);
		if (!subs) {
			subs = new Set();
			this.subscribers.set(boardId, subs);
		}
		subs.add(callback);

		const run = this.runs.get(boardId);

		// Build replay buffer
		const replay: Array<{ eventId: number; eventType: AgentStepEventType; event: AgentStepEvent }> = [];
		if (run) {
			const startFrom = lastEventId ?? 0;
			for (let i = startFrom; i < run.events.length; i++) {
				const event = run.events[i];
				replay.push({
					eventId: i + 1, // 1-based
					eventType: event.type,
					event
				});
			}
		}

		const unsubscribe = () => {
			subs!.delete(callback);
			if (subs!.size === 0) {
				this.subscribers.delete(boardId);
			}
		};

		return { replay, unsubscribe, run };
	}

	/**
	 * Get the count of active SSE subscribers for a board.
	 */
	subscriberCount(boardId: number): number {
		return this.subscribers.get(boardId)?.size ?? 0;
	}

	// ── Global finish listeners ───────────────────────────────────

	/**
	 * Register a callback that fires whenever any run reaches a terminal state.
	 * Returns an unsubscribe function.
	 */
	onFinish(callback: RunFinishCallback): () => void {
		this.finishListeners.add(callback);
		return () => {
			this.finishListeners.delete(callback);
		};
	}

	// ── Internals ─────────────────────────────────────────────────

	private emit(boardId: number, eventType: AgentStepEventType, event: AgentStepEvent): void {
		const run = this.runs.get(boardId);
		const eventId = run?.lastEventId ?? 0;
		const subs = this.subscribers.get(boardId);
		if (!subs) return;

		for (const cb of subs) {
			try {
				cb(eventId, eventType, event);
			} catch {
				// Don't let a subscriber error break others
			}
		}
	}

	private notifyFinish(run: ScrapeRun): void {
		for (const cb of this.finishListeners) {
			try {
				cb(run);
			} catch {
				// Don't let a listener error break others
			}
		}
	}

	/**
	 * Garbage-collect completed runs that have exceeded the retention period.
	 */
	private gc(): void {
		const now = Date.now();
		for (const [boardId, run] of this.runs) {
			if (
				run.completedAt != null &&
				now - run.completedAt > COMPLETED_RUN_RETENTION_MS
			) {
				this.runs.delete(boardId);
				this.subscribers.delete(boardId);
			}
		}
	}

	/**
	 * Shut down the manager (for testing / graceful shutdown).
	 */
	destroy(): void {
		if (this.gcTimer) {
			clearInterval(this.gcTimer);
			this.gcTimer = null;
		}
		this.runs.clear();
		this.subscribers.clear();
		this.finishListeners.clear();
	}
}

// ── Helpers ─────────────────────────────────────────────────────────

let counter = 0;

function generateRunId(): string {
	counter++;
	const ts = Date.now().toString(36);
	const seq = counter.toString(36).padStart(4, '0');
	const rand = Math.random().toString(36).slice(2, 6);
	return `run_${ts}_${seq}_${rand}`;
}

// ── SSE formatting ──────────────────────────────────────────────────

/**
 * Format a single SSE frame with proper `event:`, `id:`, and `data:` fields.
 *
 * Uses named event types so `EventSource` dispatches to
 * `addEventListener(eventType, ...)` instead of the generic `onmessage`.
 */
export function formatSseFrame(
	eventId: number,
	eventType: AgentStepEventType,
	event: AgentStepEvent
): string {
	const lines: string[] = [];
	lines.push(`event: ${eventType}`);
	lines.push(`id: ${eventId}`);
	lines.push(`data: ${JSON.stringify(event)}`);
	lines.push(''); // trailing newline to end the frame
	return lines.join('\n') + '\n';
}

/**
 * Format an SSE comment (keep-alive ping).
 */
export function formatSseComment(text = 'ping'): string {
	return `: ${text}\n\n`;
}

// ── Singleton ───────────────────────────────────────────────────────

export const scrapeRunManager = new ScrapeRunManager();
