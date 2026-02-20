// src/routes/api/resumes/history/[id]/download/+server.ts
// Download endpoint for resume files — supports PDF (default) and Markdown formats.
//
// GET /api/resumes/history/:id/download?format=pdf  (default)
// GET /api/resumes/history/:id/download?format=md

import { error, type RequestEvent } from '@sveltejs/kit';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

const services = createServices(db);

export async function GET({ params, url }: RequestEvent) {
	const id = Number(params.id);
	if (Number.isNaN(id) || id < 1) {
		error(400, 'Invalid id — must be a positive integer');
	}

	const entry = services.resumeHistoryService.getById(id);
	if (!entry) {
		error(404, `Resume history entry #${id} not found`);
	}

	const format = (url.searchParams.get('format') ?? 'pdf').toLowerCase();

	if (format === 'md' || format === 'markdown') {
		// ── Markdown download ─────────────────────────────────────
		const mdResult = services.resumeHistoryService.readMarkdown(id);
		if (!mdResult) {
			error(404, 'Markdown file is no longer available on disk');
		}

		const safeName = sanitiseDownloadName(entry.name);
		return new Response(mdResult.content, {
			status: 200,
			headers: {
				'Content-Type': 'text/markdown; charset=utf-8',
				'Content-Disposition': `attachment; filename="${safeName}.md"`,
				'Cache-Control': 'private, no-cache'
			}
		});
	}

	if (format === 'pdf') {
		// ── PDF download ──────────────────────────────────────────
		// Try reading an existing PDF first
		let pdfData = services.resumeHistoryService.readPdf(id);

		// If no PDF exists yet, generate one on the fly
		if (!pdfData) {
			try {
				const generated = await services.resumeHistoryService.generatePdf(id);
				if (!generated) {
					error(404, 'Markdown file is missing — cannot generate PDF');
				}
				pdfData = { buffer: generated.pdfBuffer, entry: generated.entry };
			} catch (err) {
				const message = err instanceof Error ? err.message : 'PDF generation failed';
				console.error(`[download] PDF generation failed for entry #${id}:`, message);
				error(500, `Failed to generate PDF: ${message}`);
			}
		}

		const safeName = sanitiseDownloadName(entry.name);
		const body = new Uint8Array(pdfData.buffer);
		return new Response(body, {
			status: 200,
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="${safeName}.pdf"`,
				'Content-Length': String(body.byteLength),
				'Cache-Control': 'private, no-cache'
			}
		});
	}

	error(400, `Unsupported format "${format}". Use "pdf" or "md".`);
}

/**
 * Strip characters that are unsafe in Content-Disposition filenames
 * and truncate to a reasonable length.
 */
function sanitiseDownloadName(name: string): string {
	return (
		name
			.replace(/[^\w\s.()-]/g, '')
			.replace(/\s+/g, '_')
			.slice(0, 100) || 'resume'
	);
}
