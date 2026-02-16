// src/routes/api/job-boards/[id]/+server.ts
// Single job board API endpoints

import { json } from '@sveltejs/kit';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

const services = createServices(db);

export async function GET({ params }) {
  try {
    const jobBoard = await services.jobBoardService.getJobBoard(Number(params.id));

    if (!jobBoard) {
      return json({ error: 'Job board not found' }, { status: 404 });
    }

    return json(jobBoard);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch job board';
    return json({ error: message }, { status: 500 });
  }
}

export async function PUT({ params, request }) {
  try {
    const data = await request.json();
    await services.jobBoardService.updateJobBoard(Number(params.id), data);
    return json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update job board';
    return json({ error: message }, { status: 500 });
  }
}

export async function DELETE({ params }) {
  try {
    await services.jobBoardService.deleteJobBoard(Number(params.id));
    return json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete job board';
    return json({ error: message }, { status: 500 });
  }
}
