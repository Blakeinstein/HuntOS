// src/routes/api/documents/+server.ts
// Documents API — list all documents (GET) and upload/ingest a new document (POST).

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

const services = createServices(db);

/**
 * GET /api/documents
 * Returns all documents for the current user.
 */
export const GET: RequestHandler = async () => {
	try {
		const documents = services.documentService.listDocuments();
		return json(documents);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to list documents';
		return json({ error: message }, { status: 500 });
	}
};

/**
 * POST /api/documents
 * Upload and ingest a new document.
 *
 * Accepts either:
 *   - multipart/form-data with a `file` field (for file uploads)
 *   - application/json with `{ filename, rawText, mimeType? }` (for pasted text)
 *
 * The document is chunked, embedded, and stored with vectors in sqlite-vec.
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const contentType = request.headers.get('content-type') || '';

		let filename: string;
		let rawText: string;
		let mimeType: string;

		if (contentType.includes('multipart/form-data')) {
			const formData = await request.formData();
			const file = formData.get('file');

			if (!file || !(file instanceof File)) {
				return json(
					{ error: 'No file provided. Include a "file" field in the form data.' },
					{ status: 400 }
				);
			}

			filename = file.name || 'untitled';
			mimeType = file.type || 'text/plain';
			rawText = await file.text();

			if (!rawText.trim()) {
				return json({ error: 'File is empty or contains no readable text.' }, { status: 400 });
			}
		} else {
			// JSON body: { filename, rawText, mimeType? }
			const body = await request.json();

			if (!body.filename || typeof body.filename !== 'string') {
				return json({ error: 'Missing required field: filename' }, { status: 400 });
			}
			if (!body.rawText || typeof body.rawText !== 'string') {
				return json({ error: 'Missing required field: rawText' }, { status: 400 });
			}

			filename = body.filename;
			rawText = body.rawText;
			mimeType = body.mimeType || 'text/plain';

			if (!rawText.trim()) {
				return json({ error: 'rawText is empty.' }, { status: 400 });
			}
		}

		const document = await services.documentService.createDocument({
			filename,
			rawText,
			mimeType
		});

		return json(document, { status: 201 });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to upload document';
		console.error('[api/documents] Document upload error:', error);
		return json({ error: message }, { status: 500 });
	}
};
