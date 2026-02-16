// src/routes/api/resumes/+server.ts
// Resume generation API endpoint

import { json } from '@sveltejs/kit';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

const services = createServices(db);

export async function POST({ request }) {
  try {
    const { jobDescription, customProfile } = await request.json();

    if (!jobDescription) {
      return json({ error: 'jobDescription is required' }, { status: 400 });
    }

    const resume = await services.resumeService.generateResume(
      jobDescription,
      customProfile
    );

    return json({ resume });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate resume';
    return json({ error: message }, { status: 500 });
  }
}
