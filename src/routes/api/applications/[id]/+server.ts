import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

export const PATCH: RequestHandler = async ({ params, request }) => {
	const applicationId = Number(params.id);

	if (Number.isNaN(applicationId) || applicationId <= 0) {
		return json({ error: 'Invalid application ID' }, { status: 400 });
	}

	try {
		const body = await request.json();

		const { title, company, job_description_url, job_description } = body;

		if (title !== undefined && !String(title).trim()) {
			return json({ error: 'Job title cannot be empty.' }, { status: 400 });
		}
		if (company !== undefined && !String(company).trim()) {
			return json({ error: 'Company name cannot be empty.' }, { status: 400 });
		}

		const services = createServices(db);

		const existing = await services.applicationService.getApplication(applicationId);
		if (!existing) {
			return json({ error: 'Application not found' }, { status: 404 });
		}

		await services.applicationService.updateApplication(applicationId, {
			title: title !== undefined ? String(title).trim() : undefined,
			company: company !== undefined ? String(company).trim() : undefined,
			job_description_url:
				job_description_url !== undefined
					? String(job_description_url).trim() || null
					: undefined,
			job_description:
				job_description !== undefined ? String(job_description).trim() || null : undefined
		});

		const updated = await services.applicationService.getApplication(applicationId);
		return json({ application: updated });
	} catch (err) {
		console.error('[PATCH /api/applications/:id]', err);
		return json({ error: 'Failed to update application.' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	const applicationId = Number(params.id);

	if (Number.isNaN(applicationId) || applicationId <= 0) {
		return json({ error: 'Invalid application ID' }, { status: 400 });
	}

	try {
		const services = createServices(db);

		const existing = await services.applicationService.getApplication(applicationId);
		if (!existing) {
			return json({ error: 'Application not found' }, { status: 404 });
		}

		await services.applicationService.deleteApplication(applicationId);
		return json({ success: true });
	} catch (err) {
		console.error('[DELETE /api/applications/:id]', err);
		return json({ error: 'Failed to delete application.' }, { status: 500 });
	}
};
