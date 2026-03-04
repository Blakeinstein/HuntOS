// src/routes/api/admin/files/+server.ts
// Admin API for browsing data directories and serving files for preview.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { resolve, join, extname, basename } from 'path';

// Allowed directories (relative to cwd)
const ALLOWED_DIRS: Record<string, string> = {
	resumes: resolve('data/resumes'),
	screenshots: resolve('data/logs/screenshots'),
	'user-resources': resolve('data/user-resources')
};

const VALID_BUCKETS = new Set(Object.keys(ALLOWED_DIRS));

/** Resolve a bucket+filename safely, preventing path traversal. */
function safePath(bucket: string, filename: string): string | null {
	if (!VALID_BUCKETS.has(bucket)) return null;
	const dir = ALLOWED_DIRS[bucket];
	const candidate = resolve(join(dir, filename));
	// Ensure the resolved path is still inside the allowed directory
	if (!candidate.startsWith(dir + '/') && candidate !== dir) return null;
	return candidate;
}

const MIME_MAP: Record<string, string> = {
	'.pdf': 'application/pdf',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
	'.md': 'text/markdown; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
	'.html': 'text/html; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'.doc': 'application/msword'
};

function mimeFor(filename: string): string {
	return MIME_MAP[extname(filename).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Recursively list all files under a directory.
 */
function listFilesRecursive(
	dir: string
): {
	name: string;
	relPath: string;
	size: number;
	mime: string;
	ext: string;
	modifiedAt: string;
}[] {
	if (!existsSync(dir)) return [];
	const results: {
		name: string;
		relPath: string;
		size: number;
		mime: string;
		ext: string;
		modifiedAt: string;
	}[] = [];
	for (const entry of readdirSync(dir)) {
		if (entry.startsWith('.')) continue;
		const full = join(dir, entry);
		const stat = statSync(full);
		if (stat.isDirectory()) {
			const children = listFilesRecursive(full);
			// Re-prefix with this dir's entry name
			for (const child of children) {
				results.push({ ...child, relPath: join(entry, child.relPath) });
			}
		} else {
			results.push({
				name: entry,
				relPath: entry,
				size: stat.size,
				mime: mimeFor(entry),
				ext: extname(entry).toLowerCase().slice(1),
				modifiedAt: stat.mtime.toISOString()
			});
		}
	}
	return results;
}

/**
 * GET /api/admin/files
 * List all allowed buckets with their files.
 *
 * GET /api/admin/files?bucket=resumes
 * List files in a specific bucket.
 *
 * GET /api/admin/files?bucket=resumes&file=foo.pdf
 * Serve a specific file (for preview / download).
 *
 * For the screenshots bucket, `file` may contain path separators
 * (e.g. "company-42/title-slug/final.png") — safePath handles this.
 */
export const GET: RequestHandler = async ({ url }) => {
	const bucket = url.searchParams.get('bucket');
	const file = url.searchParams.get('file');

	// ── Serve a specific file ─────────────────────────────────────────────────
	if (bucket && file) {
		if (!VALID_BUCKETS.has(bucket)) {
			return json({ error: `Unknown bucket "${bucket}"` }, { status: 404 });
		}

		// file may be a relative subpath like "run-dir/subdir/final.png"
		// safePath already handles path-traversal prevention via resolve()
		const filePath = safePath(bucket, file);
		if (!filePath) {
			return json({ error: 'Invalid file path' }, { status: 400 });
		}
		if (!existsSync(filePath)) {
			return json({ error: 'File not found' }, { status: 404 });
		}

		const stat = statSync(filePath);
		if (!stat.isFile()) {
			return json({ error: 'Not a file' }, { status: 400 });
		}

		const mime = mimeFor(file);
		const body = readFileSync(filePath);

		return new Response(body, {
			headers: {
				'Content-Type': mime,
				'Content-Length': String(body.length),
				'Content-Disposition': `inline; filename="${basename(file)}"`,
				'Cache-Control': 'no-store'
			}
		});
	}

	// ── List a specific bucket ─────────────────────────────────────────────────
	if (bucket) {
		if (!VALID_BUCKETS.has(bucket)) {
			return json({ error: `Unknown bucket "${bucket}"` }, { status: 404 });
		}

		const dir = ALLOWED_DIRS[bucket];
		if (!existsSync(dir)) {
			return json({ bucket, files: [] });
		}

		// For screenshots we need recursive traversal (nested run subdirs)
		const rawFiles =
			bucket === 'screenshots'
				? listFilesRecursive(dir).map((f) => ({
						name: f.name,
						// expose the full relative path as `name` for screenshots so
						// the admin UI can use it in the file param
						relPath: f.relPath,
						bucket,
						size: f.size,
						sizeHuman: humanSize(f.size),
						mime: f.mime,
						ext: f.ext,
						modifiedAt: f.modifiedAt
					}))
				: readdirSync(dir)
						.filter((name) => !name.startsWith('.'))
						.map((name) => {
							const filePath = join(dir, name);
							const stat = statSync(filePath);
							return {
								name,
								relPath: name,
								bucket,
								size: stat.size,
								sizeHuman: humanSize(stat.size),
								mime: mimeFor(name),
								ext: extname(name).toLowerCase().slice(1),
								modifiedAt: stat.mtime.toISOString()
							};
						});

		const files = rawFiles.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));

		return json({ bucket, files });
	}

	// ── List all buckets ───────────────────────────────────────────────────────
	const result = Object.entries(ALLOWED_DIRS).map(([name, dir]) => {
		if (!existsSync(dir)) {
			return { bucket: name, fileCount: 0, totalSize: 0, totalSizeHuman: '0 B' };
		}

		// screenshots bucket uses recursive listing
		if (name === 'screenshots') {
			const allFiles = listFilesRecursive(dir);
			const totalSize = allFiles.reduce((acc, f) => acc + f.size, 0);
			return {
				bucket: name,
				fileCount: allFiles.length,
				totalSize,
				totalSizeHuman: humanSize(totalSize)
			};
		}

		const files = readdirSync(dir).filter((f) => !f.startsWith('.'));
		const totalSize = files.reduce((acc, f) => {
			try {
				return acc + statSync(join(dir, f)).size;
			} catch {
				return acc;
			}
		}, 0);

		return {
			bucket: name,
			fileCount: files.length,
			totalSize,
			totalSizeHuman: humanSize(totalSize)
		};
	});

	return json(result);
};

/**
 * DELETE /api/admin/files
 * Body: { bucket: string, file: string }
 * Delete a specific file from a bucket.
 */
export const DELETE: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	// file may be a relPath like "run-dir/subdir/final.png" for screenshots
	const { bucket, file } = body ?? {};

	if (typeof bucket !== 'string' || !bucket) {
		return json({ error: 'Missing required field: bucket' }, { status: 400 });
	}
	if (typeof file !== 'string' || !file) {
		return json({ error: 'Missing required field: file' }, { status: 400 });
	}

	if (!VALID_BUCKETS.has(bucket)) {
		return json({ error: `Unknown bucket "${bucket}"` }, { status: 404 });
	}

	const filePath = safePath(bucket, file);
	if (!filePath) {
		return json({ error: 'Invalid file path' }, { status: 400 });
	}
	if (!existsSync(filePath)) {
		return json({ error: 'File not found' }, { status: 404 });
	}

	const { unlinkSync } = await import('fs');
	unlinkSync(filePath);

	return json({ deleted: true, bucket, file });
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function humanSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
