// src/routes/api/swimlanes/[id]/+server.ts
// Single swimlane API endpoints

import { json } from '@sveltejs/kit';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

const services = createServices(db);

export async function GET({ params }) {
  try {
    const swimlane = await services.swimlaneService.getSwimlane(Number(params.id));

    if (!swimlane) {
      return json({ error: 'Swimlane not found' }, { status: 404 });
    }

    return json(swimlane);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch swimlane';
    return json({ error: message }, { status: 500 });
  }
}

export async function PUT({ params, request }) {
  try {
    const data = await request.json();
    await services.swimlaneService.updateSwimlane(Number(params.id), data);
    return json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update swimlane';
    return json({ error: message }, { status: 500 });
  }
}

export async function DELETE({ params }) {
  try {
    await services.swimlaneService.deleteSwimlane(Number(params.id));
    return json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete swimlane';
    return json({ error: message }, { status: 500 });
  }
}
