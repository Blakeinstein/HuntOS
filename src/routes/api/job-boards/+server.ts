// src/routes/api/job-boards/+server.ts
// Job boards API endpoints

import { json } from '@sveltejs/kit';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

const services = createServices(db);

export async function GET() {
  try {
    const jobBoards = await services.jobBoardService.getJobBoards();
    return json(jobBoards);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch job boards';
    return json({ error: message }, { status: 500 });
  }
}

export async function POST({ request }) {
  try {
    const data = await request.json();
    const id = await services.jobBoardService.createJobBoard(data);
    return json({ id }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create job board';
    return json({ error: message }, { status: 500 });
  }
}
