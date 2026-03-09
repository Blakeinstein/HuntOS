// src/routes/api/screenshots/+server.ts
//
// GET /api/screenshots
// Returns a structured list of screenshot galleries (one per run folder).
// Each gallery contains the folder name and all .png/.jpg image filenames inside it.
//
// Directory structure expected:
//   data/logs/screenshots/
//     <company>-<runId>/        <- top-level run folders
//       <title>/                <- optional nested title subfolder
//         iter-01-before.png
//         iter-01-after.png
//         ...
//         final.png
//     ad-hoc/                   <- flat folder of ad-hoc screenshots
//       screenshot-*.png

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import fs from 'fs';
import path from 'path';

const SCREENSHOTS_ROOT = path.resolve('data/logs/screenshots');

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

interface GalleryImage {
	filename: string;
	/** URL path for serving the image via /api/screenshots/file/[...path] */
	url: string;
}

interface Gallery {
	/** Display name for the gallery (folder path relative to SCREENSHOTS_ROOT) */
	name: string;
	/** Relative path from SCREENSHOTS_ROOT, used as gallery id */
	relativePath: string;
	images: GalleryImage[];
}

/**
 * Recursively collect all image files under a directory.
 * Returns paths relative to SCREENSHOTS_ROOT.
 */
function collectImages(dir: string, root: string): GalleryImage[] {
	if (!fs.existsSync(dir)) return [];

	const images: GalleryImage[] = [];

	const entries = fs.readdirSync(dir, { withFileTypes: true });

	// Sort so iter-01 < iter-02 < ... < final
	entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

	for (const entry of entries) {
		if (entry.name.startsWith('.')) continue;

		const fullPath = path.join(dir, entry.name);

		if (entry.isFile()) {
			const ext = path.extname(entry.name).toLowerCase();
			if (IMAGE_EXTS.has(ext)) {
				const relativePath = path.relative(root, fullPath).replace(/\\/g, '/');
				images.push({
					filename: entry.name,
					url: `/api/screenshots/file/${relativePath}`
				});
			}
		} else if (entry.isDirectory()) {
			// Recurse into nested folders (e.g. title subfolders)
			images.push(...collectImages(fullPath, root));
		}
	}

	return images;
}

export const GET: RequestHandler = async () => {
	try {
		if (!fs.existsSync(SCREENSHOTS_ROOT)) {
			return json({ galleries: [] });
		}

		const topLevel = fs.readdirSync(SCREENSHOTS_ROOT, { withFileTypes: true });

		// Sort folder names for consistent ordering
		topLevel.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

		const galleries: Gallery[] = [];

		for (const entry of topLevel) {
			if (entry.name.startsWith('.')) continue;
			if (!entry.isDirectory()) continue;

			const folderPath = path.join(SCREENSHOTS_ROOT, entry.name);
			const images = collectImages(folderPath, SCREENSHOTS_ROOT);

			// Only include galleries that actually have images
			if (images.length === 0) continue;

			galleries.push({
				name: entry.name,
				relativePath: entry.name,
				images
			});
		}

		return json({ galleries });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to list screenshots';
		console.error('[api/screenshots] Error:', error);
		return json({ error: message }, { status: 500 });
	}
};
