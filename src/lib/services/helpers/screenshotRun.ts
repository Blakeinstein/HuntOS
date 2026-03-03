// src/lib/services/helpers/screenshotRun.ts
//
// Per-application-run screenshot capture helper.
//
// Creates a dedicated subfolder under data/logs/screenshots for each pipeline run
// and captures a full-page annotated screenshot (numbered element labels) after
// every agent iteration. Screenshots are taken *outside* the agent — directly
// from pipeline code via browserExec — so they are always captured even if the
// agent itself fails or gets stuck.
//
// Directory structure:
//   data/logs/screenshots/
//     <company>-<runId>/
//       iter-01-before.png
//       iter-01-after.png
//       iter-02-after.png
//       ...
//       final.png
//
// Filenames are zero-padded so they sort correctly in file explorers.

import fs from 'fs';
import path from 'path';
import { browserExec } from '$lib/mastra/tools/browser/exec';

// Root directory for all run screenshot folders, relative to cwd (project root).
const SCREENSHOTS_ROOT = path.join('data', 'logs', 'screenshots');

/**
 * Sanitise a string for use as a filesystem path component.
 * Keeps alphanumerics, dashes, and dots; replaces everything else with underscores.
 * Truncates to `maxLen` characters to avoid overly long paths.
 */
function sanitise(value: string, maxLen = 40): string {
	return value
		.replace(/[^a-zA-Z0-9\-_.]/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_|_$/g, '')
		.slice(0, maxLen);
}

/**
 * Build a run-specific screenshot directory path (does not create it yet).
 *
 * Format: data/logs/screenshots/<company>-<runId>/
 *
 * Grouping by company first makes it easy to browse all runs for a given
 * employer in a file explorer without wading through a flat timestamped list.
 */
export function buildRunScreenshotDir(runId: number, company: string, title: string): string {
	const companySlug = sanitise(company);
	const titleSlug = sanitise(title);
	return path.join(SCREENSHOTS_ROOT, `${companySlug}-${runId}`, titleSlug);
}

/**
 * Ensure the screenshots root and the run-specific subdirectory both exist.
 */
export function ensureRunScreenshotDir(runDir: string): void {
	// SCREENSHOTS_ROOT is guaranteed to exist by ensureDataDirs (imported via db.ts).
	// We only need to create the run-specific subdirectory here.
	if (!fs.existsSync(runDir)) {
		fs.mkdirSync(runDir, { recursive: true });
	}
}

/**
 * Capture a full-page annotated screenshot and save it to `filePath`.
 *
 * Uses `agent-browser screenshot <path> --full --annotate` so the saved image
 * includes numbered element labels — ideal for debugging what the agent saw at
 * the end of each iteration.
 *
 * Returns `true` on success, `false` if the browser command fails (non-fatal —
 * a screenshot failure should never abort the pipeline).
 */
export async function captureAnnotatedScreenshot(filePath: string): Promise<boolean> {
	try {
		// Ensure parent directory exists (defensive; run dir should already be created).
		const dir = path.dirname(filePath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}

		const result = await browserExec(['screenshot', filePath, '--full', '--annotate'], {
			timeout: 30_000
		});

		return result.success;
	} catch {
		// Never let a screenshot failure propagate — it is strictly for debugging.
		return false;
	}
}

/**
 * Build the filename for a per-iteration screenshot.
 *
 * @param runDir   - The run-specific screenshot directory.
 * @param iteration - 1-based iteration number.
 * @param tag       - Short label, e.g. "after" or "before".
 */
export function iterationScreenshotPath(
	runDir: string,
	iteration: number,
	tag: 'before' | 'after' | 'final'
): string {
	if (tag === 'final') {
		return path.join(runDir, 'final.png');
	}
	const n = String(iteration).padStart(2, '0');
	return path.join(runDir, `iter-${n}-${tag}.png`);
}

/**
 * Convenience: capture the "after" screenshot for a given iteration.
 * Logs a simple console message on failure so the pipeline log stays clean.
 */
export async function captureIterationScreenshot(
	runDir: string,
	iteration: number,
	tag: 'before' | 'after' | 'final' = 'after'
): Promise<void> {
	const filePath = iterationScreenshotPath(runDir, iteration, tag);
	const ok = await captureAnnotatedScreenshot(filePath);
	if (!ok) {
		console.warn(
			`[screenshotRun] Failed to capture ${tag} screenshot for iteration ${iteration}: ${filePath}`
		);
	}
}
