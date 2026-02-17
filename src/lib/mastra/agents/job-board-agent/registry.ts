import type { Agent } from '@mastra/core/agent';

/**
 * A registered sub-agent entry: a URL pattern matcher paired with
 * a factory that lazily creates the corresponding agent.
 */
export interface SubAgentEntry {
	/** Human-readable board name (e.g. "LinkedIn", "Greenhouse"). */
	board: string;

	/** Agent ID using dot notation (e.g. "job-board-agent.linkedin"). */
	agentId: string;

	/**
	 * Returns `true` if this sub-agent should handle the given URL.
	 * Checked in registration order — first match wins.
	 */
	match: (url: string) => boolean;

	/** Factory that creates (or returns a cached) Agent instance. */
	create: () => Agent;
}

/**
 * Registry that maps job board URLs to site-specific scraping sub-agents.
 *
 * Sub-agents are registered with a URL-matching predicate and a lazy
 * factory function. At routing time the registry walks entries in
 * registration order and returns the first match.
 *
 * A fallback "generic" entry should always be registered last so that
 * unrecognised boards still get a scraping agent.
 *
 * @example
 * ```ts
 * const registry = new SubAgentRegistry();
 *
 * registry.register({
 *   board: 'LinkedIn',
 *   agentId: 'job-board-agent.linkedin',
 *   match: (url) => /linkedin\.com/i.test(url),
 *   create: () => createLinkedInAgent(),
 * });
 *
 * const entry = registry.resolve('https://www.linkedin.com/jobs/search?keywords=ts');
 * // entry.board => "LinkedIn"
 * // entry.create() => Agent
 * ```
 */
export class SubAgentRegistry {
	private entries: SubAgentEntry[] = [];

	/**
	 * Register a sub-agent entry. Entries are evaluated in the order
	 * they are registered — register more specific patterns first.
	 */
	register(entry: SubAgentEntry): this {
		this.entries.push(entry);
		return this;
	}

	/**
	 * Find the first sub-agent entry whose `match` predicate returns
	 * `true` for the given URL.
	 *
	 * @returns The matching `SubAgentEntry`, or `undefined` if nothing matched.
	 */
	resolve(url: string): SubAgentEntry | undefined {
		return this.entries.find((entry) => entry.match(url));
	}

	/**
	 * Like `resolve`, but throws if no entry matches (should never happen
	 * when a generic fallback is registered).
	 */
	resolveOrThrow(url: string): SubAgentEntry {
		const entry = this.resolve(url);
		if (!entry) {
			throw new Error(
				`No sub-agent registered for URL: ${url}\n` +
					`Registered boards: ${this.entries.map((e) => e.board).join(', ') || '(none)'}`
			);
		}
		return entry;
	}

	/**
	 * Return a snapshot of all registered entries (useful for debugging
	 * or listing available boards in a UI).
	 */
	list(): ReadonlyArray<Omit<SubAgentEntry, 'create'>> {
		return this.entries.map(({ board, agentId, match }) => ({ board, agentId, match }));
	}
}
