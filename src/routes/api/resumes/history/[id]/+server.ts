// src/routes/api/resumes/history/[id]/+server.ts
// Individual resume history entry API — get details or delete a single entry.

import { json, type RequestEvent } from '@sveltejs/kit';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

const services = createServices(db);

/**
 * GET /api/resumes/history/:id
 *
 * Fetch a single resume history entry by ID.
 *
 * Query params:
 *   include_markdown=true  — also read and return the Markdown file content
 *
 * Response includes a `file_exists` boolean. If `false`, the file has been
 * removed from disk but the metadata and generation parameters are still
 * available so the resume can be re-generated.
 */
export async function GET({ params, url }: RequestEvent) {
	const id = Number(params.id);
	if (Number.isNaN(id) || id < 1) {
		return json({ error: 'Invalid id — must be a positive integer' }, { status: 400 });
	}

	try {
		const entry = services.resumeHistoryService.getById(id);
		if (!entry) {
			return json({ error: `Resume history entry #${id} not found` }, { status: 404 });
		}

		const includeMarkdown = url.searchParams.get('include_markdown') === 'true';

		if (includeMarkdown) {
			const result = services.resumeHistoryService.readMarkdown(id);
			if (!result) {
				// Entry exists but file is missing on disk
				return json({
					...entry,
					markdown: null,
					file_missing_message:
						'The Markdown file is no longer available on disk. ' +
						'The generation parameters are still stored — you can re-generate this resume.'
				});
			}

			return json({
				...result.entry,
				markdown: result.content
			});
		}

		// If the file is missing, add a note
		if (!entry.file_exists) {
			return json({
				...entry,
				file_missing_message:
					'The Markdown file is no longer available on disk. ' +
					'The generation parameters are still stored — you can re-generate this resume.'
			});
		}

		return json(entry);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to fetch resume history entry';
		return json({ error: message }, { status: 500 });
	}
}

/**
 * DELETE /api/resumes/history/:id
 *
 * Delete a single resume history entry and its associated file on disk.
 */
export async function DELETE({ params }: RequestEvent) {
	const id = Number(params.id);
	if (Number.isNaN(id) || id < 1) {
		return json({ error: 'Invalid id — must be a positive integer' }, { status: 400 });
	}

	try {
		const entry = services.resumeHistoryService.getById(id);
		if (!entry) {
			return json({ error: `Resume history entry #${id} not found` }, { status: 404 });
		}

		const deleted = services.resumeHistoryService.delete(id);
		if (!deleted) {
			return json({ error: 'Failed to delete entry' }, { status: 500 });
		}

		// Audit the deletion
		services.auditLogService.create({
			category: 'resume',
			status: 'info',
			title: `Deleted resume history entry: ${entry.name}`,
			detail: `Removed entry #${id} and its file at ${entry.file_path}`,
			meta: {
				historyId: id,
				resumeName: entry.name,
				filePath: entry.file_path,
				fileExisted: entry.file_exists
			}
		});

		return json({
			deleted: true,
			message: `Resume history entry #${id} ("${entry.name}") has been deleted`
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Failed to delete resume history entry';
		return json({ error: message }, { status: 500 });
	}
}
