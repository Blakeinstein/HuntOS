import { json } from '@sveltejs/kit';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

const services = createServices(db);

/**
 * GET /api/profiles/links/summarize
 * Returns all link summaries with their current status.
 */
export async function GET() {
	try {
		const summaries = services.linkSummaryService.getAll();
		const queueState = services.linkSummaryQueue.getState();
		return json({ summaries, queue: queueState });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to fetch summaries';
		return json({ error: message }, { status: 500 });
	}
}

/**
 * POST /api/profiles/links/summarize
 * Enqueue a single link for summarisation.
 *
 * Body: { title: string; url: string }
 */
export async function POST({ request }) {
	try {
		const body = await request.json();
		const { title, url } = body ?? {};

		if (!title || typeof title !== 'string') {
			return json({ error: 'Missing required field: title' }, { status: 400 });
		}
		if (!url || typeof url !== 'string') {
			return json({ error: 'Missing required field: url' }, { status: 400 });
		}

		// Basic URL validation
		try {
			new URL(url);
		} catch {
			return json({ error: 'Invalid URL' }, { status: 400 });
		}

		const enqueued = services.linkSummaryQueue.enqueue({ title, url });
		const summary = services.linkSummaryService.getByTitle(title);
		const queueState = services.linkSummaryQueue.getState();

		return json({
			enqueued,
			message: enqueued
				? `Job queued for "${title}"`
				: `A job for "${title}" is already pending or running`,
			summary,
			queue: queueState
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to enqueue job';
		return json({ error: message }, { status: 500 });
	}
}
