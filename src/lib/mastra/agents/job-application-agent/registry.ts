import type { Agent } from '@mastra/core/agent';

/**
 * A registered application sub-agent entry: a URL pattern matcher paired
 * with a factory that lazily creates the corresponding agent.
 *
 * Mirrors the `SubAgentEntry` pattern from the job-board-agent registry,
 * but scoped to job *application* sites rather than scraping targets.
 */
export interface ApplicationSubAgentEntry {
	/** Human-readable site/ATS name (e.g. "LinkedIn", "Greenhouse", "Lever"). */
	site: string;

	/** Agent ID using dot notation (e.g. "job-application-agent.linkedin"). */
	agentId: string;

	/**
	 * Returns `true` if this sub-agent should handle applications on the given URL.
	 * Checked in registration order — first match wins.
	 */
	match: (url: string) => boolean;

	/** Factory that creates (or returns a cached) Agent instance. */
	create: () => Agent;
}

/**
 * Registry that maps job application URLs to site-specific application
 * sub-agents.
 *
 * Sub-agents are registered with a URL-matching predicate and a lazy
 * factory function. At routing time the registry walks entries in
 * registration order and returns the first match.
 *
 * A fallback "generic" entry should always be registered last so that
 * unrecognised sites still get an application agent.
 *
 * @example
 * ```ts
 * const registry = new ApplicationSubAgentRegistry();
 *
 * registry.register({
 *   site: 'Greenhouse',
 *   agentId: 'job-application-agent.greenhouse',
 *   match: (url) => /greenhouse\.io/i.test(url),
 *   create: () => createGreenhouseApplicationAgent(),
 * });
 *
 * const entry = registry.resolve('https://boards.greenhouse.io/acme/jobs/123');
 * // entry.site => "Greenhouse"
 * // entry.create() => Agent
 * ```
 */
export class ApplicationSubAgentRegistry {
	private entries: ApplicationSubAgentEntry[] = [];

	/**
	 * Register a sub-agent entry. Entries are evaluated in the order
	 * they are registered — register more specific patterns first.
	 */
	register(entry: ApplicationSubAgentEntry): this {
		this.entries.push(entry);
		return this;
	}

	/**
	 * Find the first sub-agent entry whose `match` predicate returns
	 * `true` for the given URL.
	 *
	 * @returns The matching `ApplicationSubAgentEntry`, or `undefined` if nothing matched.
	 */
	resolve(url: string): ApplicationSubAgentEntry | undefined {
		return this.entries.find((entry) => entry.match(url));
	}

	/**
	 * Like `resolve`, but throws if no entry matches (should never happen
	 * when a generic fallback is registered).
	 */
	resolveOrThrow(url: string): ApplicationSubAgentEntry {
		const entry = this.resolve(url);
		if (!entry) {
			throw new Error(
				`No application sub-agent registered for URL: ${url}\n` +
					`Registered sites: ${this.entries.map((e) => e.site).join(', ') || '(none)'}`
			);
		}
		return entry;
	}

	/**
	 * Return a snapshot of all registered entries (useful for debugging
	 * or listing available sites in a UI).
	 */
	list(): ReadonlyArray<Omit<ApplicationSubAgentEntry, 'create'>> {
		return this.entries.map(({ site, agentId, match }) => ({ site, agentId, match }));
	}
}
