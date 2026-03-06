// src/lib/services/helpers/pipelineContext.ts
//
// Lightweight context tracker that lets tool-call callbacks know which
// pipeline run is currently active so they can write step logs in
// real-time (not just at iteration boundaries).
//
// The apply pipeline executor sets the context before launching the
// agent loop and clears it when done. The `onToolCall` callback in
// mastra/index.ts reads the context to decide whether to also write
// a pipeline step log entry.
//
// This uses a simple module-level variable rather than AsyncLocalStorage
// because the pipeline executor is single-threaded (one pipeline run at
// a time, enforced by the global active run check).

import type {
	ApplicationPipelineService,
	PipelineStep
} from '$lib/services/services/applicationPipeline';
import { browserExec } from '$lib/mastra/tools/browser/exec';
import path from 'path';
import fs from 'fs';

// ── Types ───────────────────────────────────────────────────────────

export interface PipelineContext {
	/** The active pipeline run ID */
	runId: number;
	/** The current pipeline step (typically 'apply' during agent execution) */
	step: PipelineStep;
	/** The pipeline service instance for writing step logs */
	pipelineService: ApplicationPipelineService;
	/** Absolute path to the per-run screenshot directory */
	screenshotDir: string;
	/** Application ID for resource linking */
	applicationId: number;
	/** Counter for proactive screenshots within an iteration */
	screenshotCounter: number;
}

// ── Module-level state ──────────────────────────────────────────────

let activePipelineContext: PipelineContext | null = null;

// ── Public API ──────────────────────────────────────────────────────

/**
 * Set the active pipeline context. Call this before launching the agent
 * loop so that tool-call callbacks can write step logs in real-time.
 */
export function setPipelineContext(ctx: Omit<PipelineContext, 'screenshotCounter'>): void {
	activePipelineContext = { ...ctx, screenshotCounter: 0 };
}

/**
 * Clear the active pipeline context. Call this after the agent loop
 * completes (in a finally block to ensure cleanup).
 */
export function clearPipelineContext(): void {
	activePipelineContext = null;
}

/**
 * Get the current pipeline context, or null if no pipeline is running.
 */
export function getPipelineContext(): PipelineContext | null {
	return activePipelineContext;
}

/**
 * Increment and return the screenshot counter for the current context.
 * Returns 0 if no context is active.
 */
export function nextScreenshotIndex(): number {
	if (!activePipelineContext) return 0;
	activePipelineContext.screenshotCounter += 1;
	return activePipelineContext.screenshotCounter;
}

/**
 * Reset the screenshot counter (e.g. at the start of each iteration).
 */
export function resetScreenshotCounter(): void {
	if (activePipelineContext) {
		activePipelineContext.screenshotCounter = 0;
	}
}

// ── Tool categories for smart logging ───────────────────────────────

/** Tools that navigate to a new page — always worth logging + screenshotting */
const NAVIGATION_TOOLS = new Set([
	'browser-open',
	'browser-back',
	'browser-forward',
	'browser-reload'
]);

/** Tools that interact with form elements — log with details */
const INTERACTION_TOOLS = new Set([
	'browser-click',
	'browser-dblclick',
	'browser-fill',
	'browser-type',
	'browser-press',
	'browser-hover',
	'browser-select',
	'browser-check',
	'browser-uncheck',
	'browser-upload'
]);

/** Tools that observe the page — log briefly */
const OBSERVATION_TOOLS = new Set([
	'browser-snapshot',
	'browser-screenshot',
	'browser-screenshot-annotated',
	'browser-observe-page'
]);

/** Tools that extract data — log briefly */
const EXTRACTION_TOOLS = new Set([
	'browser-get-text',
	'browser-get-html',
	'browser-get-value',
	'browser-get-attribute',
	'browser-get-count',
	'browser-is-visible',
	'browser-is-enabled',
	'browser-is-checked',
	'browser-eval'
]);

/** Tools that wait for conditions — only log on failure */
const WAIT_TOOLS = new Set([
	'browser-wait-selector',
	'browser-wait-time',
	'browser-wait-text',
	'browser-wait-url',
	'browser-wait-load',
	'browser-wait-condition'
]);

/** Tools after which we should proactively capture a screenshot */
const SCREENSHOT_AFTER_TOOLS = new Set([
	'browser-open',
	'browser-click',
	'browser-dblclick',
	'browser-fill',
	'browser-select',
	'browser-check',
	'browser-uncheck',
	'browser-upload',
	'browser-press',
	'browser-back',
	'browser-forward'
]);

// ── Tool call → pipeline log formatting ─────────────────────────────

/**
 * Format a tool call event into a human-readable pipeline log message.
 * Returns null if the tool call should be silently skipped (e.g. wait-time).
 */
export function formatToolCallForPipelineLog(
	toolId: string,
	input: Record<string, unknown>,
	output: Record<string, unknown> | undefined,
	success: boolean,
	durationMs: number
): { message: string; level: 'info' | 'progress' | 'warn' | 'error' } | null {
	const duration = durationMs > 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`;

	// ── Failures always get logged ──────────────────────────────────
	if (!success) {
		const errorHint = output
			? ((output as Record<string, unknown>).message ??
				(output as Record<string, unknown>).error ??
				JSON.stringify(output).slice(0, 200))
			: 'unknown error';
		return {
			message: `✗ ${toolId} failed (${duration}): ${errorHint}`,
			level: 'warn'
		};
	}

	// ── Navigation ──────────────────────────────────────────────────
	if (NAVIGATION_TOOLS.has(toolId)) {
		const url = input.url ?? input.href ?? '';
		if (toolId === 'browser-open') {
			return {
				message: `🌐 Navigating to: ${String(url).slice(0, 120)}`,
				level: 'progress'
			};
		}
		return {
			message: `🌐 ${toolId.replace('browser-', '')} (${duration})`,
			level: 'progress'
		};
	}

	// ── Interactions ────────────────────────────────────────────────
	if (INTERACTION_TOOLS.has(toolId)) {
		const action = toolId.replace('browser-', '');
		const ref = input.ref ?? input.selector ?? '';
		const value = input.value ?? input.text ?? '';

		if (toolId === 'browser-fill' || toolId === 'browser-type') {
			// Truncate long values (don't expose full form data in logs)
			const safeValue =
				String(value).length > 60 ? String(value).slice(0, 57) + '…' : String(value);
			return {
				message: `✏️ ${action} "${safeValue}" → ${ref} (${duration})`,
				level: 'progress'
			};
		}
		if (toolId === 'browser-click' || toolId === 'browser-dblclick') {
			return {
				message: `🖱️ ${action} ${ref} (${duration})`,
				level: 'progress'
			};
		}
		if (toolId === 'browser-select') {
			return {
				message: `📋 select "${value}" in ${ref} (${duration})`,
				level: 'progress'
			};
		}
		if (toolId === 'browser-upload') {
			return {
				message: `📎 upload file → ${ref} (${duration})`,
				level: 'progress'
			};
		}
		if (toolId === 'browser-press') {
			const key = input.key ?? '';
			return {
				message: `⌨️ press "${key}" on ${ref} (${duration})`,
				level: 'progress'
			};
		}
		return {
			message: `🔧 ${action} ${ref} (${duration})`,
			level: 'progress'
		};
	}

	// ── Observation tools ───────────────────────────────────────────
	if (OBSERVATION_TOOLS.has(toolId)) {
		if (toolId === 'browser-snapshot') {
			return {
				message: `👁️ snapshot taken (${duration})`,
				level: 'info'
			};
		}
		if (toolId === 'browser-screenshot-annotated' || toolId === 'browser-observe-page') {
			return {
				message: `📸 ${toolId.replace('browser-', '')} (${duration})`,
				level: 'progress'
			};
		}
		return {
			message: `📷 screenshot (${duration})`,
			level: 'info'
		};
	}

	// ── Extraction tools ────────────────────────────────────────────
	if (EXTRACTION_TOOLS.has(toolId)) {
		const action = toolId.replace('browser-', '');
		return {
			message: `🔍 ${action} (${duration})`,
			level: 'info'
		};
	}

	// ── Wait tools — only log if slow or failed ─────────────────────
	if (WAIT_TOOLS.has(toolId)) {
		if (durationMs > 5000) {
			return {
				message: `⏳ ${toolId.replace('browser-', '')} took ${duration}`,
				level: 'info'
			};
		}
		// Short waits are not worth logging to the pipeline UI
		return null;
	}

	// ── Fallback for unknown tools ──────────────────────────────────
	return {
		message: `🔧 ${toolId} (${duration})`,
		level: 'info'
	};
}

/**
 * Determines if a proactive screenshot should be taken after this tool call.
 */
export function shouldCaptureScreenshotAfter(toolId: string, success: boolean): boolean {
	// Only screenshot after successful calls to avoid capturing error states
	// that are about to be retried
	return success && SCREENSHOT_AFTER_TOOLS.has(toolId);
}

/**
 * Capture a proactive screenshot and log it to the pipeline step logs.
 *
 * The screenshot is saved to the run's screenshot directory with a
 * descriptive name including the tool that triggered it.
 *
 * Returns the file path if successful, null otherwise.
 */
export async function captureProactiveScreenshot(toolId: string): Promise<string | null> {
	const ctx = activePipelineContext;
	if (!ctx) return null;

	const index = nextScreenshotIndex();
	const safeTool = toolId.replace(/[^a-zA-Z0-9-]/g, '_');
	const filename = `step-${String(index).padStart(3, '0')}-${safeTool}.png`;
	const filePath = path.join(ctx.screenshotDir, filename);

	// Ensure directory exists
	const dir = path.dirname(filePath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	// Use --annotate so the screenshot has numbered element labels overlaid,
	// making it useful for visual navigation audit (not just a plain capture).
	// Also use --full to capture the entire scrollable page.
	const absolutePath = path.resolve(filePath);
	let ok = false;
	try {
		const result = await browserExec(['screenshot', '--annotate', '--full', absolutePath], {
			timeout: 30_000
		});
		ok = result.success;
	} catch {
		// Never let a screenshot failure propagate — it is strictly for audit.
		ok = false;
	}

	if (ok) {
		// Log the screenshot path in meta so the frontend can display it
		ctx.pipelineService.addStepLog(
			ctx.runId,
			ctx.step,
			'info',
			`📸 Screenshot after ${toolId.replace('browser-', '')}`,
			{
				screenshotPath: path.relative(process.cwd(), filePath),
				toolId,
				screenshotIndex: index
			}
		);
		return filePath;
	}

	return null;
}

/**
 * Write a tool call event to pipeline step logs if a pipeline is active.
 *
 * This is designed to be called from the `onToolCall` callback in
 * mastra/index.ts alongside the existing audit log write.
 *
 * Optionally captures a proactive screenshot after key interactions.
 */
export async function logToolCallToPipeline(
	toolId: string,
	input: Record<string, unknown>,
	output: Record<string, unknown> | undefined,
	success: boolean,
	durationMs: number
): Promise<void> {
	const ctx = activePipelineContext;
	if (!ctx) return;

	// Format the tool call as a human-readable log message
	const formatted = formatToolCallForPipelineLog(toolId, input, output, success, durationMs);

	if (formatted) {
		ctx.pipelineService.addStepLog(ctx.runId, ctx.step, formatted.level, formatted.message, {
			toolId,
			durationMs,
			// Include minimal input context for debugging (not the full payload)
			...(input.ref ? { ref: input.ref } : {}),
			...(input.selector ? { selector: input.selector } : {}),
			...(input.url ? { url: String(input.url).slice(0, 200) } : {})
		});
	}

	// Capture proactive screenshot after key interaction tools
	if (shouldCaptureScreenshotAfter(toolId, success)) {
		// Fire-and-forget — don't block the agent on screenshot capture.
		// The screenshot is a nice-to-have for audit, not critical path.
		captureProactiveScreenshot(toolId).catch((err) => {
			console.warn(`[pipelineContext] Proactive screenshot failed after ${toolId}:`, err);
		});
	}
}
