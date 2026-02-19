// src/routes/api/user-resources/+server.ts
// API for uploading user resources (files + URLs) from the chat interface.
// Files are stored on disk under data/user-resources/ AND ingested as documents.
// URLs are added to the profile links list.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServices } from '$lib/services';
import { db } from '$lib/db';
import { writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const services = createServices(db);

const USER_RESOURCES_DIR = resolve('data/user-resources');

// Ensure directory exists on module load
if (!existsSync(USER_RESOURCES_DIR)) {
	mkdirSync(USER_RESOURCES_DIR, { recursive: true });
}

/**
 * GET /api/user-resources
 * List all files in the user-resources directory.
 */
export const GET: RequestHandler = async () => {
	try {
		if (!existsSync(USER_RESOURCES_DIR)) {
			return json([]);
		}

		const files = readdirSync(USER_RESOURCES_DIR)
			.filter((name) => !name.startsWith('.'))
			.map((name) => {
				const filePath = join(USER_RESOURCES_DIR, name);
				const info = statSync(filePath);
				return {
					filename: name,
					path: filePath,
					size: info.size
				};
			});

		return json(files);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to list resources';
		return json({ error: message }, { status: 500 });
	}
};

/**
 * POST /api/user-resources
 *
 * Accepts either:
 *   - multipart/form-data with a `file` field (file upload)
 *   - application/json with `{ url, title?, description? }` (add a URL as a link)
 *
 * For file uploads:
 *   1. Saves the file to data/user-resources/
 *   2. Ingests it as a document (chunk + embed)
 *   3. Returns the created document metadata
 *
 * For URL submissions:
 *   1. Adds the URL to the profile links list
 *   2. Returns the updated links
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const contentType = request.headers.get('content-type') || '';

		if (contentType.includes('multipart/form-data')) {
			return await handleFileUpload(request);
		} else {
			return await handleUrlSubmission(request);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to process resource';
		console.error('User resource error:', error);
		return json({ error: message }, { status: 500 });
	}
};

async function handleFileUpload(request: Request): Promise<Response> {
	const formData = await request.formData();
	const file = formData.get('file');

	if (!file || !(file instanceof File)) {
		return json(
			{ error: 'No file provided. Include a "file" field in the form data.' },
			{ status: 400 }
		);
	}

	const rawText = await file.text();
	if (!rawText.trim()) {
		return json({ error: 'File is empty or contains no readable text.' }, { status: 400 });
	}

	const filename = file.name || 'untitled';
	const mimeType = file.type || 'text/plain';

	// 1. Save file to data/user-resources/ (deduplicate filename if needed)
	const savedFilename = deduplicateFilename(filename);
	const filePath = join(USER_RESOURCES_DIR, savedFilename);
	const buffer = await file.arrayBuffer();
	writeFileSync(filePath, Buffer.from(buffer));

	// 2. Ingest as a document (chunk + embed + store vectors)
	const document = await services.documentService.createDocument({
		filename: savedFilename,
		rawText,
		mimeType
	});

	return json(
		{
			type: 'file',
			document,
			savedPath: filePath,
			filename: savedFilename
		},
		{ status: 201 }
	);
}

async function handleUrlSubmission(request: Request): Promise<Response> {
	const body = await request.json();

	if (!body.url || typeof body.url !== 'string') {
		return json({ error: 'Missing required field: url' }, { status: 400 });
	}

	const url: string = body.url.trim();
	const title: string = body.title?.trim() || extractTitleFromUrl(url);
	const description: string = body.description?.trim() || '';

	// Validate URL format
	try {
		new URL(url);
	} catch {
		return json({ error: 'Invalid URL format' }, { status: 400 });
	}

	// Add to profile links
	const linkId = `link_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	const link = { id: linkId, title, url, description };
	const updatedLinks = await services.profileService.upsertProfileLink(link);

	// Also store in website_urls
	await services.profileService.appendToProfile('website_urls', [url]);

	return json(
		{
			type: 'url',
			link,
			links: updatedLinks
		},
		{ status: 201 }
	);
}

/**
 * Generate a unique filename by appending a counter if the file already exists.
 */
function deduplicateFilename(filename: string): string {
	if (!existsSync(join(USER_RESOURCES_DIR, filename))) {
		return filename;
	}

	const dotIndex = filename.lastIndexOf('.');
	const name = dotIndex >= 0 ? filename.slice(0, dotIndex) : filename;
	const ext = dotIndex >= 0 ? filename.slice(dotIndex) : '';

	let counter = 1;
	let candidate: string;
	do {
		candidate = `${name}-${counter}${ext}`;
		counter++;
	} while (existsSync(join(USER_RESOURCES_DIR, candidate)));

	return candidate;
}

/**
 * Extract a human-readable title from a URL.
 */
function extractTitleFromUrl(url: string): string {
	try {
		const parsed = new URL(url);
		const host = parsed.hostname.replace('www.', '');

		// Capitalize known domains
		const knownTitles: Record<string, string> = {
			'github.com': 'GitHub',
			'linkedin.com': 'LinkedIn',
			'gitlab.com': 'GitLab',
			'stackoverflow.com': 'Stack Overflow',
			'dev.to': 'Dev.to',
			'medium.com': 'Medium',
			'behance.net': 'Behance',
			'dribbble.com': 'Dribbble'
		};

		return knownTitles[host] || host;
	} catch {
		return 'Website';
	}
}
