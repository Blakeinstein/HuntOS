import { json } from '@sveltejs/kit';
import { createServices } from '$lib/services';
import { db } from '$lib/db';
import type { ResumeFormat } from '$lib/services/services/appSettings';

const services = createServices(db);

const VALID_RESUME_FORMATS: ResumeFormat[] = ['markdown', 'typst'];

/**
 * GET /api/settings
 *
 * Returns all app settings as a key-value object.
 */
export async function GET() {
	const settings = services.appSettingsService.list();

	const result: Record<string, string> = {};
	for (const s of settings) {
		result[s.key] = s.value;
	}

	return json({ settings: result });
}

/**
 * PUT /api/settings
 *
 * Update one or more settings. Accepts a flat JSON object of key-value pairs.
 *
 * Body: { "resume_format": "typst" }
 */
export async function PUT({ request }) {
	const body = await request.json();

	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return json({ error: 'Request body must be a JSON object of key-value pairs' }, { status: 400 });
	}

	const updated: Record<string, string> = {};
	const errors: string[] = [];

	for (const [key, value] of Object.entries(body)) {
		if (typeof value !== 'string') {
			errors.push(`"${key}" must be a string value`);
			continue;
		}

		// Validate well-known keys
		if (key === 'resume_format') {
			if (!VALID_RESUME_FORMATS.includes(value as ResumeFormat)) {
				errors.push(
					`Invalid resume_format "${value}". Must be one of: ${VALID_RESUME_FORMATS.join(', ')}`
				);
				continue;
			}
			services.appSettingsService.set('resume_format', value as ResumeFormat);
		} else {
			// Allow arbitrary keys via raw setter
			services.appSettingsService.setRaw(key, value);
		}

		updated[key] = value;
	}

	if (errors.length > 0 && Object.keys(updated).length === 0) {
		return json({ error: 'No settings were updated', errors }, { status: 400 });
	}

	return json({
		updated,
		...(errors.length > 0 ? { warnings: errors } : {})
	});
}
