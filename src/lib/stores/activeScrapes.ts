/**
 * Reactive store for tracking active scrape streams across pages.
 *
 * When a scrape is started from the job boards page (ScrapeButton),
 * it registers here so the audit page can pick it up and show
 * live streaming updates without the user having to manually
 * select a board and click "Start Stream".
 *
 * IMPORTANT: Every mutation creates a **new object** for the SvelteMap
 * entry so that `$derived(activeScrapes.get(id))` properly re-evaluates.
 * Mutating the existing object in-place and re-setting the same reference
 * does NOT reliably trigger Svelte's fine-grained reactivity.
 */

import { SvelteMap } from 'svelte/reactivity';
import type {
	AgentStepEvent,
	ScrapeFinishPayload,
	ScrapeErrorPayload
} from '$lib/services/services/agentStream.types';

export type ScrapeStreamState = 'connecting' | 'streaming' | 'done' | 'error';

export interface ActiveScrape {
	/** Job board database ID. */
	boardId: number;
	/** Human-readable board name. */
	boardName: string;
	/** Current stream state. */
	state: ScrapeStreamState;
	/** All events received so far. */
	events: AgentStepEvent[];
	/** Terminal finish payload (if completed). */
	finishPayload: ScrapeFinishPayload | null;
	/** Terminal error payload (if errored). */
	errorPayload: ScrapeErrorPayload | null;
	/** Timestamp when the scrape was initiated. */
	startedAt: number;
	/** AbortController for cancelling the stream. */
	abortController: AbortController | null;
}

/**
 * Global reactive map of active scrapes keyed by board ID.
 *
 * Using SvelteMap so mutations (set/delete) are automatically
 * tracked by Svelte's reactivity system.
 */
export const activeScrapes = new SvelteMap<number, ActiveScrape>();

/**
 * Callbacks that fire whenever a scrape finishes (success or error).
 * The audit page subscribes here to auto-refresh its log list.
 */
type FinishCallback = (boardId: number, scrape: ActiveScrape) => void;
const finishListeners = new Set<FinishCallback>();

export function onScrapeFinish(callback: FinishCallback): () => void {
	finishListeners.add(callback);
	return () => {
		finishListeners.delete(callback);
	};
}

function notifyFinish(boardId: number, scrape: ActiveScrape) {
	for (const cb of finishListeners) {
		try {
			cb(boardId, scrape);
		} catch {
			// Don't let a listener error break others
		}
	}
}

/**
 * Register and start a new scrape stream for a given board.
 *
 * Returns a handle with methods to push events, complete, or abort.
 */
export function registerScrape(boardId: number, boardName: string): ScrapeStreamHandle {
	// Abort any existing scrape for this board
	const existing = activeScrapes.get(boardId);
	if (existing?.abortController) {
		existing.abortController.abort();
	}

	const abortController = new AbortController();

	const scrape: ActiveScrape = {
		boardId,
		boardName,
		state: 'connecting',
		events: [],
		finishPayload: null,
		errorPayload: null,
		startedAt: Date.now(),
		abortController
	};

	activeScrapes.set(boardId, scrape);

	return new ScrapeStreamHandle(boardId);
}

/**
 * Remove a completed/dismissed scrape from the active map.
 */
export function dismissScrape(boardId: number) {
	const scrape = activeScrapes.get(boardId);
	if (scrape?.abortController) {
		scrape.abortController.abort();
	}
	activeScrapes.delete(boardId);
}

/**
 * Check if a board currently has an active (non-terminal) scrape.
 */
export function isScrapeActive(boardId: number): boolean {
	const scrape = activeScrapes.get(boardId);
	if (!scrape) return false;
	return scrape.state === 'connecting' || scrape.state === 'streaming';
}

// ── Terminal states that should never be overwritten ─────────────────
const TERMINAL_STATES: ScrapeStreamState[] = ['done', 'error'];

function isTerminal(state: ScrapeStreamState): boolean {
	return TERMINAL_STATES.includes(state);
}

/**
 * Handle returned by `registerScrape()` for pushing events and
 * updating the scrape's state from the streaming fetch loop.
 *
 * All mutations create a **new object spread** and re-set it in
 * the SvelteMap so that Svelte's reactivity system detects the change.
 * We never hold a stale reference — we always read the latest from
 * the map before applying updates.
 */
export class ScrapeStreamHandle {
	private readonly boardId: number;
	private _abortSignal: AbortSignal;

	constructor(boardId: number) {
		this.boardId = boardId;
		// Capture the signal at construction time so it's always available
		// even after the abortController is nulled out on terminal state.
		const scrape = activeScrapes.get(boardId);
		this._abortSignal = scrape!.abortController!.signal;
	}

	/** The abort signal for the stream fetch. Always available. */
	get signal(): AbortSignal {
		return this._abortSignal;
	}

	/**
	 * Read the current scrape from the map.
	 * Returns null if the scrape was dismissed.
	 */
	private current(): ActiveScrape | null {
		return activeScrapes.get(this.boardId) ?? null;
	}

	/**
	 * Replace the map entry with a new object containing the patch.
	 * Skips the update if the scrape has been dismissed or is already
	 * in a terminal state (unless `force` is true).
	 */
	private update(patch: Partial<ActiveScrape>, force = false): ActiveScrape | null {
		const prev = this.current();
		if (!prev) return null;

		// Don't overwrite terminal states unless forced
		if (!force && isTerminal(prev.state) && patch.state && !isTerminal(patch.state)) {
			return prev;
		}

		// Create a brand-new object so SvelteMap sees a new reference
		const next: ActiveScrape = { ...prev, ...patch };
		activeScrapes.set(this.boardId, next);
		return next;
	}

	/** Transition from 'connecting' to 'streaming'. */
	markStreaming() {
		const prev = this.current();
		if (!prev || isTerminal(prev.state)) return;
		this.update({ state: 'streaming' });
	}

	/** Push a new event into the events array. */
	pushEvent(event: AgentStepEvent) {
		const prev = this.current();
		if (!prev) return;
		// Always allow pushing events even in terminal state
		// (the terminal event itself needs to be added before
		// we transition the state)
		this.update({ events: [...prev.events, event] }, true);
	}

	/** Mark stream as successfully finished. */
	finish(payload: ScrapeFinishPayload) {
		const prev = this.current();
		if (!prev) return;
		// Don't overwrite an existing terminal state
		if (isTerminal(prev.state)) return;

		const next = this.update(
			{
				state: 'done',
				finishPayload: payload,
				abortController: null
			},
			true
		);
		if (next) notifyFinish(this.boardId, next);
	}

	/** Mark stream as errored. */
	error(payload: ScrapeErrorPayload) {
		const prev = this.current();
		if (!prev) return;
		if (isTerminal(prev.state)) return;

		const next = this.update(
			{
				state: 'error',
				errorPayload: payload,
				abortController: null
			},
			true
		);
		if (next) notifyFinish(this.boardId, next);
	}

	/**
	 * Mark stream as done without a specific payload.
	 * Called when the SSE read loop ends without receiving a terminal event.
	 * Only transitions if still in a non-terminal state.
	 */
	complete() {
		const prev = this.current();
		if (!prev) return;
		if (isTerminal(prev.state)) return;

		const next = this.update(
			{
				state: 'done',
				abortController: null
			},
			true
		);
		if (next) notifyFinish(this.boardId, next);
	}

	/** Abort the stream (user-initiated cancel). */
	abort() {
		const prev = this.current();
		if (!prev) return;

		// Abort the controller so the fetch is cancelled
		prev.abortController?.abort();

		if (isTerminal(prev.state)) return;

		this.update(
			{
				state: 'error',
				abortController: null
			},
			true
		);
	}
}
