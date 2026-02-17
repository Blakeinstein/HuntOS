import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
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
 * ## Nested Resolution (dot-notation)
 *
 * Prompt IDs that contain dots are resolved using a folder-based lookup:
 *
 * 1. `job-board-agent` → `job-board-agent.md` (flat, top-level)
 * 2. `job-board-agent.linkedin` → `job-board-agent/job-board-agent.linkedin.md` (nested)
 *
 * The prefix before the first dot is used as the subfolder name. This keeps
 * related prompts grouped while allowing dot-notation agent IDs.
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
	 *
	 * // Nested prompt (dot-notation resolves to subfolder)
	 * const { content } = promptRegistry.getPrompt({
	 *   promptId: 'job-board-agent.linkedin',
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
	 * List all available prompt IDs (scanned from .md files in the prompts
	 * directory, including nested subdirectories).
	 */
	listPrompts(): string[] {
		return this.scanDir(this.promptDir);
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
	 * Recursively scan a directory for `.md` files and return prompt IDs.
	 */
	private scanDir(dir: string): string[] {
		const ids: string[] = [];
		try {
			const entries = readdirSync(dir);
			for (const entry of entries) {
				const fullPath = join(dir, entry);
				try {
					const stat = statSync(fullPath);
					if (stat.isDirectory()) {
						ids.push(...this.scanDir(fullPath));
					} else if (entry.endsWith('.md')) {
						ids.push(basename(entry, '.md'));
					}
				} catch {
					// skip unreadable entries
				}
			}
		} catch {
			// directory doesn't exist or isn't readable
		}
		return ids;
	}

	/**
	 * Resolve a prompt ID to its file path on disk.
	 *
	 * Resolution order:
	 * 1. Flat: `{promptDir}/{promptId}.md`
	 * 2. Nested: `{promptDir}/{prefix}/{promptId}.md`
	 *    where `prefix` is the segment before the first dot.
	 *
	 * This allows `job-board-agent.linkedin` to resolve to
	 * `prompts/job-board-agent/job-board-agent.linkedin.md`.
	 */
	private resolvePath(promptId: string): string {
		// Try flat path first
		const flatPath = resolve(this.promptDir, `${promptId}.md`);
		try {
			statSync(flatPath);
			return flatPath;
		} catch {
			// flat path doesn't exist, try nested
		}

		// Try nested path: use prefix before first dot as subfolder
		const dotIndex = promptId.indexOf('.');
		if (dotIndex !== -1) {
			const prefix = promptId.substring(0, dotIndex);
			const nestedPath = resolve(this.promptDir, prefix, `${promptId}.md`);
			try {
				statSync(nestedPath);
				return nestedPath;
			} catch {
				// nested path doesn't exist either
			}
		}

		// Also try using the full promptId as a subfolder name (no dots)
		// e.g. `job-board-agent` → `job-board-agent/job-board-agent.md`
		const folderPath = resolve(this.promptDir, promptId, `${promptId}.md`);
		try {
			statSync(folderPath);
			return folderPath;
		} catch {
			// none of the paths resolved
		}

		throw new Error(
			`Prompt file not found for "${promptId}". Searched:\n` +
				`  - ${flatPath}\n` +
				(dotIndex !== -1
					? `  - ${resolve(this.promptDir, promptId.substring(0, dotIndex), `${promptId}.md`)}\n`
					: '') +
				`  - ${folderPath}`
		);
	}

	/**
	 * Load the raw markdown content for a prompt ID, with caching.
	 */
	private loadBase(promptId: string): string {
		const cached = this.cache.get(promptId);
		if (cached !== undefined) return cached;

		const promptPath = this.resolvePath(promptId);

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
