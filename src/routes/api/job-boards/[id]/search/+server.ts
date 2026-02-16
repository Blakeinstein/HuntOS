// src/routes/api/job-boards/[id]/search/+server.ts
// Job board search API endpoint — invokes the job-board-agent with dynamic URL + profile context

import { json } from '@sveltejs/kit';
import { createServices } from '$lib/services';
import { db } from '$lib/db';
import { mastra } from '../../../../../mastra';
import { scrapeJobBoard } from '../../../../../mastra/agents/job-board-scraper';

const services = createServices(db);

export async function POST({ params }) {
	const jobBoardId = Number(params.id);

	if (Number.isNaN(jobBoardId)) {
		return json({ error: 'Invalid job board ID' }, { status: 400 });
	}

	try {
		const result = await scrapeJobBoard(mastra, services.profileService, services.jobBoardService, {
			jobBoardId
		});

		const status = result.success ? 200 : result.scrapeResult?.blocked ? 403 : 500;

		return json(result, { status });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to search job board';
		return json({ error: message }, { status: 500 });
	}
}
