// src/routes/api/swimlanes/[id]/applications/+server.ts
// Applications in swimlane API endpoint

import { json } from '@sveltejs/kit';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

const services = createServices(db);

export async function GET({ params }) {
  try {
    const applications = await services.applicationService.getApplications(Number(params.id));
    return json(applications);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch swimlane applications';
    return json({ error: message }, { status: 500 });
  }
}
