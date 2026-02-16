// src/routes/api/swimlanes/+server.ts
// Swimlanes API endpoints

import { json } from '@sveltejs/kit';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

const services = createServices(db);

export async function GET() {
  try {
    const swimlanes = await services.swimlaneService.getSwimlanes();
    return json(swimlanes);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch swimlanes';
    return json({ error: message }, { status: 500 });
  }
}

export async function POST({ request }) {
  try {
    const data = await request.json();
    if (!data.name) {
      return json({ error: 'Swimlane name is required' }, { status: 400 });
    }
    const id = await services.swimlaneService.createSwimlane(data.name, data.description);
    return json({ id }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create swimlane';
    return json({ error: message }, { status: 500 });
  }
}
