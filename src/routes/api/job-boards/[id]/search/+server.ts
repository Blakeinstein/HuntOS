// src/routes/api/job-boards/[id]/search/+server.ts
// Job board search API endpoint

import { json } from '@sveltejs/kit';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

const services = createServices(db);

export async function POST({ params }) {
  try {
    const result = await services.jobBoardService.searchJobBoard(Number(params.id));
    return json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to search job board';
    return json({ error: message }, { status: 500 });
  }
}
