// src/routes/api/job-boards/[id]/search/+server.ts
// Job board search API endpoint — invokes the job-board-agent with dynamic URL + profile context

import { json } from '@sveltejs/kit';
import { services } from '$lib/mastra';

export async function POST({ params }) {
	const jobBoardId = Number(params.id);

	if (Number.isNaN(jobBoardId)) {
		return json({ error: 'Invalid job board ID' }, { status: 400 });
	}

	if (!services.jobBoardScraperService) {
		return json({ error: 'Scraper service not initialized' }, { status: 503 });
	}

	try {
		const result = await services.jobBoardScraperService.scrape({ jobBoardId });

		const status = result.success ? 200 : result.scrapeResult?.blocked ? 403 : 500;

		return json(result, { status });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to search job board';
		return json({ error: message }, { status: 500 });
	}
}
