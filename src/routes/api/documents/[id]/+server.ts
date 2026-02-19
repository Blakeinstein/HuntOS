// src/routes/api/documents/[id]/+server.ts
// Single document API — GET details (with chunks), DELETE to remove.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

const services = createServices(db);

/**
 * GET /api/documents/:id
 * Returns a single document with its chunks.
 */
export const GET: RequestHandler = async ({ params }) => {
	try {
		const id = Number(params.id);
		if (Number.isNaN(id)) {
			return json({ error: 'Invalid document ID' }, { status: 400 });
		}

		const document = services.documentService.getDocument(id);
		if (!document) {
			return json({ error: 'Document not found' }, { status: 404 });
		}

		const chunks = services.documentService.getChunks(id);

		return json({ ...document, chunks });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to fetch document';
		return json({ error: message }, { status: 500 });
	}
};

/**
 * DELETE /api/documents/:id
 * Delete a document and all its chunks + vectors.
 */
export const DELETE: RequestHandler = async ({ params }) => {
	try {
		const id = Number(params.id);
		if (Number.isNaN(id)) {
			return json({ error: 'Invalid document ID' }, { status: 400 });
		}

		const document = services.documentService.getDocument(id);
		if (!document) {
			return json({ error: 'Document not found' }, { status: 404 });
		}

		const deleted = services.documentService.deleteDocument(id);
		if (!deleted) {
			return json({ error: 'Failed to delete document' }, { status: 500 });
		}

		return json({ success: true, message: `Deleted "${document.filename}" and all associated chunks.` });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to delete document';
		return json({ error: message }, { status: 500 });
	}
};
