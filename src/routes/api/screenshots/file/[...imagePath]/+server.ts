// src/routes/api/screenshots/file/[...imagePath]/+server.ts
//
// GET /api/screenshots/file/<relative-path-to-image>
// Serves a screenshot image from data/logs/screenshots/ with path traversal protection.

import type { RequestHandler } from './$types';
import fs from 'fs';
import path from 'path';

const SCREENSHOTS_ROOT = path.resolve('data/logs/screenshots');

const MIME_TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif'
};

export const GET: RequestHandler = async ({ params }) => {
	const imagePath = params.imagePath ?? '';

	// Resolve the full path and ensure it stays within SCREENSHOTS_ROOT (path traversal guard)
	const fullPath = path.resolve(SCREENSHOTS_ROOT, imagePath);

	if (!fullPath.startsWith(SCREENSHOTS_ROOT + path.sep) && fullPath !== SCREENSHOTS_ROOT) {
		return new Response('Forbidden', { status: 403 });
	}

	const ext = path.extname(fullPath).toLowerCase();
	const mimeType = MIME_TYPES[ext];

	if (!mimeType) {
		return new Response('Unsupported file type', { status: 415 });
	}

	if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
		return new Response('Not found', { status: 404 });
	}

	const buffer = fs.readFileSync(fullPath);

	return new Response(buffer, {
		status: 200,
		headers: {
			'Content-Type': mimeType,
			'Content-Length': String(buffer.length),
			'Cache-Control': 'public, max-age=3600'
		}
	});
};
