// src/routes/api/applications/[id]/move/+server.ts
// Move application swimlane API endpoint

import { json } from '@sveltejs/kit';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

const services = createServices(db);

export async function POST({ params, request }) {
  try {
    const { swimlaneId, reason, changedBy } = await request.json();

    await services.applicationService.moveApplication(
      Number(params.id),
      swimlaneId,
      reason,
      changedBy || 'user'
    );

    return json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to move application';
    return json({ error: message }, { status: 500 });
  }
}
