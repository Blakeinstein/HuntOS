// src/lib/mastra/tools/browser/vision.ts
// Vision-based browser tools — annotated screenshots that return image data
// to the model via toModelOutput for visual page understanding.
//
// The `agent-browser screenshot --annotate` command takes a screenshot with
// numbered element labels overlaid on each interactive element. Vision-capable
// models can "read" these labels and reference them (e.g. "[1]", "[2]") to
// decide which elements to interact with.
//
// The annotated screenshot tool uses Mastra's `toModelOutput` to send the
// image as multimodal content (`image-data` part) so the model receives
// the actual pixels alongside any text description.
//
// When a pipeline run is active (detected via pipelineContext), screenshots
// are automatically saved into the run's screenshot directory for audit.
// The pipeline step log also gets an entry with the screenshot path so
// the frontend can display inline thumbnails.
//
// NOTE: `toModelOutput` is supported at runtime by @mastra/core >=1.4.0 but
// the TypeScript type definitions (ToolAction interface) don't include it yet.
// We use `Object.assign` to attach it after creation so TypeScript is happy
// while the runtime behavior works correctly.

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import * as nodePath from 'node:path';
import { browserExec } from './exec';
import { coerceBoolean } from '$lib/utils/boolean';
import { getPipelineContext, nextScreenshotIndex } from '$lib/services/helpers/pipelineContext';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCREENSHOTS_VISION_DIR = nodePath.join('data', 'logs', 'screenshots', 'vision');

function ensureDir(dir: string): void {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

/**
 * Build the default save path for an annotated screenshot.
 *
 * When a pipeline context is active the screenshot is saved into the
 * run's screenshot directory (so it appears in the audit trail).
 * Otherwise it falls back to the generic vision screenshots dir.
 */
function defaultAnnotatedPath(toolLabel: string = 'annotated'): string {
	const ctx = getPipelineContext();
	if (ctx) {
		const idx = nextScreenshotIndex();
		const filename = `step-${String(idx).padStart(3, '0')}-${toolLabel}.png`;
		const dir = ctx.screenshotDir;
		ensureDir(dir);
		return nodePath.join(dir, filename);
	}

	ensureDir(SCREENSHOTS_VISION_DIR);
	const ts = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
	return nodePath.join(SCREENSHOTS_VISION_DIR, `${toolLabel}-${ts}.png`);
}

function readImageAsBase64(filePath: string): string | null {
	try {
		const buffer = readFileSync(filePath);
		return buffer.toString('base64');
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Output types (used by toModelOutput transforms)
// ---------------------------------------------------------------------------

interface AnnotatedScreenshotOutput {
	success: boolean;
	message: string;
	filePath: string;
	output: string;
}

interface ObservePageOutput {
	success: boolean;
	message: string;
	screenshotPath: string;
	snapshot: string;
	screenshotSuccess: boolean;
	snapshotSuccess: boolean;
}

/**
 * Log a vision-tool screenshot to the pipeline step logs (if active)
 * so the frontend can show an inline thumbnail.
 */
function logScreenshotToPipeline(filePath: string, toolId: string): void {
	const ctx = getPipelineContext();
	if (!ctx) return;

	const relPath = nodePath.relative(process.cwd(), nodePath.resolve(filePath));
	ctx.pipelineService.addStepLog(ctx.runId, ctx.step, 'info', `📸 ${toolId} screenshot saved`, {
		screenshotPath: relPath,
		toolId
	});
}

// ---------------------------------------------------------------------------
// toModelOutput transforms
//
// These are attached to the tools via Object.assign after creation so that
// TypeScript doesn't complain about the missing property in the ToolAction
// interface. The runtime picks them up correctly.
// ---------------------------------------------------------------------------

function annotatedScreenshotToModelOutput(output: AnnotatedScreenshotOutput) {
	if (!output.success) {
		return {
			type: 'text' as const,
			value: `Annotated screenshot failed: ${output.message}`
		};
	}

	const base64 = readImageAsBase64(output.filePath);

	if (!base64) {
		return {
			type: 'text' as const,
			value:
				`Annotated screenshot was taken and saved to ${output.filePath}, ` +
				`but the image file could not be read back for vision analysis. ` +
				`Use browser_snapshot to inspect the page via the accessibility tree instead.`
		};
	}

	return {
		type: 'content' as const,
		value: [
			{
				type: 'text' as const,
				text:
					'Annotated screenshot of the current page. Each numbered label (e.g. [1], [2]) ' +
					'marks an interactive element. Use these visual labels to understand the page ' +
					'layout, then call browser_snapshot to get element refs for interaction. ' +
					`Saved to: ${output.filePath}`
			},
			{
				type: 'image-data' as const,
				data: base64,
				mimeType: 'image/png' as const
			}
		]
	};
}

function observePageToModelOutput(output: ObservePageOutput) {
	const parts: Array<
		{ type: 'text'; text: string } | { type: 'image-data'; data: string; mimeType: 'image/png' }
	> = [];

	// Always include the snapshot text — it has the actionable refs
	parts.push({
		type: 'text' as const,
		text:
			'## Page Observation\n\n' +
			'### Accessibility Snapshot (use @e refs for interactions)\n\n' +
			output.snapshot
	});

	// Include the annotated screenshot image if available
	if (output.screenshotSuccess) {
		const base64 = readImageAsBase64(output.screenshotPath);
		if (base64) {
			parts.push({
				type: 'text' as const,
				text:
					'\n\n### Annotated Screenshot\n' +
					'Each numbered label [1], [2], etc. marks an interactive element. ' +
					'Cross-reference with the accessibility snapshot above for @e refs.'
			});
			parts.push({
				type: 'image-data' as const,
				data: base64,
				mimeType: 'image/png' as const
			});
		} else {
			parts.push({
				type: 'text' as const,
				text:
					'\n\n### Annotated Screenshot\n' +
					`Screenshot saved to ${output.screenshotPath} but could not be loaded for vision analysis.`
			});
		}
	}

	return {
		type: 'content' as const,
		value: parts
	};
}

// ---------------------------------------------------------------------------
// Annotated Screenshot Tool
// ---------------------------------------------------------------------------

const _screenshotAnnotated = createTool({
	id: 'browser-screenshot-annotated',
	description:
		'Take an ANNOTATED screenshot of the current page. Each interactive element is ' +
		'overlaid with a numbered label (e.g. [1], [2], [3]). The image is returned ' +
		'directly to you so you can SEE the page. Use the numbered labels to identify ' +
		'buttons, inputs, links, dropdowns, and other elements visually. ' +
		'After viewing the screenshot, call browser_snapshot to get the @e refs that ' +
		'correspond to the visual labels, then use those refs for interaction. ' +
		'This is your PRIMARY tool for understanding what the page looks like.',
	inputSchema: z.object({
		path: z
			.string()
			.optional()
			.describe(
				'Optional file path to save the annotated screenshot. ' +
					'If not provided, saves to the default vision screenshots directory.'
			),
		fullPage: z
			.boolean()
			.or(z.string())
			.optional()
			.default(false)
			.describe('Capture the entire scrollable page (not just the viewport)')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string(),
		filePath: z.string().describe('The file path where the annotated screenshot was saved'),
		output: z.string().describe('Raw CLI output from the screenshot command')
	}),
	execute: async ({ path, fullPage }) => {
		const savePath = path ?? defaultAnnotatedPath('screenshot-annotated');

		// Ensure the parent directory exists
		const dir = nodePath.dirname(savePath);
		ensureDir(dir);

		const args = ['screenshot', '--annotate'];
		if (coerceBoolean(fullPage)) args.push('--full');
		args.push(savePath);

		const result = await browserExec(args, { timeout: 30_000 });

		if (!result.success) {
			return {
				success: false,
				message: `Failed to take annotated screenshot: ${result.stderr}`,
				filePath: savePath,
				output: result.stderr
			};
		}

		// Log to pipeline step logs for audit trail
		logScreenshotToPipeline(savePath, 'browser-screenshot-annotated');

		return {
			success: true,
			message: 'Annotated screenshot taken — numbered labels overlay each interactive element',
			filePath: savePath,
			output: result.stdout
		};
	}
});

// Attach toModelOutput at runtime (type definitions lag behind the runtime API)
export const screenshotAnnotated = Object.assign(_screenshotAnnotated, {
	toModelOutput: annotatedScreenshotToModelOutput
});

// ---------------------------------------------------------------------------
// Observe Page Tool (combined annotated screenshot + snapshot)
// ---------------------------------------------------------------------------

const _observePage = createTool({
	id: 'browser-observe-page',
	description:
		'Take an annotated screenshot AND an accessibility snapshot in one call. ' +
		'This is your GO-TO tool for understanding any page. You receive: ' +
		'(1) an annotated screenshot image showing numbered labels [1], [2], [3] on ' +
		'every interactive element so you can SEE the page layout, AND ' +
		'(2) the accessibility tree with @e refs for interaction. ' +
		'Use the screenshot to visually identify elements and the snapshot @e refs ' +
		'to interact with them. Call this after every navigation, page transition, ' +
		'or form step change. The screenshot is your eyes — the snapshot is your hands.',
	inputSchema: z.object({
		path: z.string().optional().describe('Optional file path to save the annotated screenshot'),
		fullPage: z
			.boolean()
			.or(z.string())
			.optional()
			.default(false)
			.describe('Capture the full scrollable page'),
		interactive: z
			.boolean()
			.or(z.string())
			.optional()
			.default(true)
			.describe('Only show interactive elements in the snapshot (default: true)')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string(),
		screenshotPath: z.string(),
		snapshot: z.string().describe('The accessibility tree snapshot text'),
		screenshotSuccess: z.boolean(),
		snapshotSuccess: z.boolean()
	}),
	execute: async ({ path, fullPage, interactive }) => {
		const savePath = path ?? defaultAnnotatedPath('observe-page');
		const dir = nodePath.dirname(savePath);
		ensureDir(dir);

		// Run annotated screenshot and snapshot in parallel for speed
		const [screenshotResult, snapshotResult] = await Promise.all([
			browserExec(
				['screenshot', '--annotate', ...(coerceBoolean(fullPage) ? ['--full'] : []), savePath],
				{ timeout: 30_000 }
			),
			browserExec(['snapshot', ...(coerceBoolean(interactive) ? ['-i'] : [])], { timeout: 15_000 })
		]);

		const bothOk = screenshotResult.success && snapshotResult.success;
		const partialOk = screenshotResult.success || snapshotResult.success;

		let message: string;
		if (bothOk) {
			message = 'Page observed — annotated screenshot and accessibility snapshot both captured';
		} else if (screenshotResult.success) {
			message = `Annotated screenshot captured, but snapshot failed: ${snapshotResult.stderr}`;
		} else if (snapshotResult.success) {
			message = `Snapshot captured, but annotated screenshot failed: ${screenshotResult.stderr}`;
		} else {
			message = `Both screenshot and snapshot failed. Screenshot: ${screenshotResult.stderr}. Snapshot: ${snapshotResult.stderr}`;
		}

		// Log to pipeline step logs for audit trail
		if (screenshotResult.success) {
			logScreenshotToPipeline(savePath, 'browser-observe-page');
		}

		return {
			success: partialOk,
			message,
			screenshotPath: savePath,
			snapshot: snapshotResult.success
				? snapshotResult.stdout
				: `Snapshot failed: ${snapshotResult.stderr}`,
			screenshotSuccess: screenshotResult.success,
			snapshotSuccess: snapshotResult.success
		};
	}
});

// Attach toModelOutput at runtime (type definitions lag behind the runtime API)
export const observePage = Object.assign(_observePage, {
	toModelOutput: observePageToModelOutput
});
