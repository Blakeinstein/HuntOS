import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * A simple file-based prompt registry that loads markdown prompts
 * from `src/lib/mastra/prompts/` by agent ID.
 *
 * Follows the Mastra "prompt registry" pattern so agents can fetch
 * prompts at runtime — including dynamic context injection — without
 * hard-coding instructions in code.
 *
 * @see https://mastra.ai/docs/server/request-context#fetching-from-a-prompt-registry
 */

export interface GetPromptOptions {
	/** The agent ID whose prompt file to load (maps to `{promptId}.md`). */
	promptId: string;

	/**
	 * Optional key/value pairs to append as a "## Runtime Context" section
	 * at the end of the prompt. Each entry becomes a subsection:
	 *
	 * ```
	 * ## Runtime Context
	 * ### Key Name
	 * value
	 * ```
	 */
	context?: Record<string, string>;
}

export interface PromptResult {
	/** The fully-assembled prompt content (base markdown + optional context). */
	content: string;
	/** The raw base prompt without any injected context. */
	base: string;
	/** The prompt ID that was resolved. */
	promptId: string;
}

class PromptRegistry {
	private cache = new Map<string, string>();
	private promptDir: string;

	constructor(promptDir?: string) {
		this.promptDir = promptDir ?? __dirname;
	}

	/**
	 * Load a prompt by agent/prompt ID with optional runtime context injection.
	 *
	 * @example
	 * ```ts
	 * // Simple load (no context)
	 * const { content } = promptRegistry.getPrompt({ promptId: 'profile-agent' });
	 *
	 * // With dynamic context appended
	 * const { content } = promptRegistry.getPrompt({
	 *   promptId: 'job-board-agent',
	 *   context: {
	 *     'Target URL': 'https://linkedin.com/jobs/search?keywords=typescript',
	 *     'User Profile': JSON.stringify(profileData, null, 2),
	 *   },
	 * });
	 * ```
	 */
	getPrompt({ promptId, context }: GetPromptOptions): PromptResult {
		const base = this.loadBase(promptId);

		if (!context || Object.keys(context).length === 0) {
			return { content: base, base, promptId };
		}

		const contextSections = Object.entries(context)
			.map(([key, value]) => `### ${key}\n${value}`)
			.join('\n\n');

		const content = `${base}\n\n## Runtime Context\n\n${contextSections}`;

		return { content, base, promptId };
	}

	/**
	 * List all available prompt IDs (scanned from .md files in the prompts directory).
	 */
	listPrompts(): string[] {
		try {
			return readdirSync(this.promptDir)
				.filter((f) => f.endsWith('.md'))
				.map((f) => basename(f, '.md'));
		} catch {
			return [];
		}
	}

	/**
	 * Check whether a prompt file exists for the given ID.
	 */
	hasPrompt(promptId: string): boolean {
		try {
			this.loadBase(promptId);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Clear the in-memory cache (useful for tests or hot-reload scenarios).
	 */
	clearCache(): void {
		this.cache.clear();
	}

	/**
	 * Load the raw markdown content for a prompt ID, with caching.
	 */
	private loadBase(promptId: string): string {
		const cached = this.cache.get(promptId);
		if (cached !== undefined) return cached;

		const promptPath = resolve(this.promptDir, `${promptId}.md`);

		try {
			const content = readFileSync(promptPath, 'utf-8').trim();
			this.cache.set(promptId, content);
			return content;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to load prompt for "${promptId}": ${message}`);
		}
	}
}

/**
 * Singleton prompt registry instance, reading from `src/lib/mastra/prompts/`.
 */
export const promptRegistry = new PromptRegistry();

/**
 * Convenience function — loads a prompt by agent ID (backwards-compatible).
 * Equivalent to `promptRegistry.getPrompt({ promptId }).content`.
 */
export function loadPrompt(agentId: string): string {
	return promptRegistry.getPrompt({ promptId: agentId }).content;
}
