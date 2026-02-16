// src/routes/api/profiles/+server.ts
// Profile API endpoints

import { json } from '@sveltejs/kit';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

const services = createServices(db);

export async function GET() {
  try {
    const profile = await services.profileService.getProfile();
    return json(profile);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch profile';
    return json({ error: message }, { status: 500 });
  }
}

export async function PUT({ request }) {
  try {
    const data = await request.json();

    for (const [key, value] of Object.entries(data)) {
      await services.profileService.updateProfile(key as any, value);
    }

    return json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update profile';
    return json({ error: message }, { status: 500 });
  }
}
