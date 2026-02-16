// src/mastra/tools/browser/exec.ts
// Utility for executing agent-browser CLI commands

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const CDP_PORT = process.env.AGENT_BROWSER_CDP_PORT ?? '9222';

export interface BrowserExecResult {
	stdout: string;
	stderr: string;
	success: boolean;
}

/**
 * Execute an agent-browser CLI command, automatically connecting via CDP.
 *
 * @param args - The command arguments (e.g. ['open', 'https://example.com'])
 * @param options - Optional overrides
 * @returns The combined stdout/stderr and success flag
 */
export async function browserExec(
	args: string[],
	options: { timeout?: number; json?: boolean; cdpPort?: string } = {}
): Promise<BrowserExecResult> {
	const { timeout = 30_000, json = false, cdpPort = CDP_PORT } = options;

	const fullArgs = ['--cdp', cdpPort, ...(json ? ['--json'] : []), ...args];

	try {
		const { stdout, stderr } = await execFileAsync('npx', ['agent-browser', ...fullArgs], {
			timeout,
			maxBuffer: 10 * 1024 * 1024, // 10 MB for screenshots / snapshots
			env: { ...process.env }
		});

		return { stdout: stdout.trim(), stderr: stderr.trim(), success: true };
	} catch (error: unknown) {
		const err = error as { stdout?: string; stderr?: string; message?: string };
		return {
			stdout: err.stdout?.trim() ?? '',
			stderr: err.stderr?.trim() ?? err.message ?? 'Unknown error',
			success: false
		};
	}
}

/**
 * Execute a command and parse the JSON output.
 */
export async function browserExecJson<T = unknown>(
	args: string[],
	options: { timeout?: number; cdpPort?: string } = {}
): Promise<{ data: T | null; error: string | null }> {
	const result = await browserExec(args, { ...options, json: true });

	if (!result.success) {
		return { data: null, error: result.stderr || 'Command failed' };
	}

	try {
		const data = JSON.parse(result.stdout) as T;
		return { data, error: null };
	} catch {
		// Some commands return plain text even with --json flag
		return { data: result.stdout as unknown as T, error: null };
	}
}
