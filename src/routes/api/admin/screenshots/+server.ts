// src/routes/api/admin/screenshots/+server.ts
// Admin API for browsing the nested data/logs/screenshots run directories
// and serving individual screenshot files for inline preview.
//
// GET /api/admin/screenshots
//   → List all run directories with file counts and timestamps
//
// GET /api/admin/screenshots?run=<runDir>
//   → List all files inside a specific run directory (including subdirs)
//
// GET /api/admin/screenshots?run=<runDir>&file=<filename>
//   → Serve a specific PNG file for inline preview

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { resolve, join, relative, basename } from 'path';

const SCREENSHOTS_ROOT = resolve('data/logs/screenshots');

/**
 * Safely resolve a path under SCREENSHOTS_ROOT, preventing traversal.
 * Returns null if the resolved path escapes the root.
 */
function safePath(parts: string[]): string | null {
	const candidate = resolve(join(SCREENSHOTS_ROOT, ...parts));
	if (candidate !== SCREENSHOTS_ROOT && !candidate.startsWith(SCREENSHOTS_ROOT + '/')) {
		return null;
	}
	return candidate;
}

/**
 * Recursively list all .png files under a directory.
 * Returns paths relative to the given base dir.
 */
function listPngsRecursive(dir: string, base: string): { name: string; relPath: string; size: number; modifiedAt: string }[] {
	if (!existsSync(dir)) return [];
	const results: { name: string; relPath: string; size: number; modifiedAt: string }[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const stat = statSync(full);
		if (stat.isDirectory()) {
			results.push(...listPngsRecursive(full, base));
		} else if (entry.toLowerCase().endsWith('.png')) {
			results.push({
				name: entry,
				relPath: relative(base, full),
				size: stat.size,
				modifiedAt: stat.mtime.toISOString()
			});
		}
	}
	return results.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

export const GET: RequestHandler = async ({ url }) => {
	const runParam = url.searchParams.get('run');
	const fileParam = url.searchParams.get('file');

	// ── Serve a specific file ─────────────────────────────────────────────────
	if (runParam && fileParam) {
		// runParam may contain path separators (e.g. "company-42/title-slug")
		const runSegments = runParam.split('/').filter(Boolean);
		const fileSegments = fileParam.split('/').filter(Boolean);
		const filePath = safePath([...runSegments, ...fileSegments]);

		if (!filePath) {
			return json({ error: 'Invalid path' }, { status: 400 });
		}
		if (!existsSync(filePath)) {
			return json({ error: 'File not found' }, { status: 404 });
		}
		const stat = statSync(filePath);
		if (!stat.isFile()) {
			return json({ error: 'Not a file' }, { status: 400 });
		}

		const body = readFileSync(filePath);
		return new Response(body, {
			headers: {
				'Content-Type': 'image/png',
				'Content-Length': String(body.length),
				'Content-Disposition': `inline; filename="${basename(filePath)}"`,
				'Cache-Control': 'no-store'
			}
		});
	}

	// ── List files inside a specific run dir ──────────────────────────────────
	if (runParam) {
		const segments = runParam.split('/').filter(Boolean);
		const runPath = safePath(segments);

		if (!runPath) {
			return json({ error: 'Invalid run path' }, { status: 400 });
		}
		if (!existsSync(runPath)) {
			return json({ error: 'Run directory not found' }, { status: 404 });
		}

		const files = listPngsRecursive(runPath, runPath);
		return json({ run: runParam, files });
	}

	// ── List all top-level run directories ────────────────────────────────────
	if (!existsSync(SCREENSHOTS_ROOT)) {
		return json([]);
	}

	const runs: {
		run: string;
		fileCount: number;
		latestAt: string | null;
	}[] = [];

	function collectRuns(dir: string, prefix: string) {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			const stat = statSync(full);
			if (!stat.isDirectory()) continue;

			const runKey = prefix ? `${prefix}/${entry}` : entry;

			// Check if this dir contains any PNGs directly or in subdirs
			const files = listPngsRecursive(full, full);
			if (files.length > 0) {
				const latestAt = files.reduce<string | null>((latest, f) => {
					if (!latest || f.modifiedAt > latest) return f.modifiedAt;
					return latest;
				}, null);
				runs.push({ run: runKey, fileCount: files.length, latestAt });
			} else {
				// Recurse one level deeper (company → title subdirs)
				collectRuns(full, runKey);
			}
		}
	}

	collectRuns(SCREENSHOTS_ROOT, '');

	// Sort newest first
	runs.sort((a, b) => {
		if (!a.latestAt) return 1;
		if (!b.latestAt) return -1;
		return b.latestAt.localeCompare(a.latestAt);
	});

	return json(runs);
};
