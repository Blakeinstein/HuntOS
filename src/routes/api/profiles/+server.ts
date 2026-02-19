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
			if (!services.profileService.isValidProfileKey(key)) {
				continue;
			}

			if (typeof value === 'string') {
				await services.profileService.updateProfile(key as any, value);
				continue;
			}

			if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
				await services.profileService.updateProfile(key as any, value);
				continue;
			}

			// For complex values (arrays of objects, nested structures), serialize to JSON string
			if (typeof value === 'object' && value !== null) {
				await services.profileService.updateProfile(key as any, JSON.stringify(value));
				continue;
			}

			return json({ error: `Invalid value for ${key}` }, { status: 400 });
		}

		return json({ success: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to update profile';
		return json({ error: message }, { status: 500 });
	}
}
