import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load a markdown prompt file by agent ID.
 * Looks for `src/mastra/prompts/{agentId}.md` and returns its contents as a string.
 */
export function loadPrompt(agentId: string): string {
	const promptPath = resolve(__dirname, `${agentId}.md`);

	try {
		return readFileSync(promptPath, 'utf-8').trim();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to load prompt for agent "${agentId}": ${message}`);
	}
}
