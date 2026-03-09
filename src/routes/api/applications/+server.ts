import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();

		const { title, company, job_description_url, job_description } = body;

		if (!title?.trim()) {
			return json({ error: 'Job title is required.' }, { status: 400 });
		}

		if (!company?.trim()) {
			return json({ error: 'Company name is required.' }, { status: 400 });
		}

		const services = createServices(db);

		const id = await services.applicationService.createApplication({
			title: title.trim(),
			company: company.trim(),
			job_description_url: job_description_url?.trim() || undefined,
			job_description: job_description?.trim() || undefined,
			manually_added: true
		});

		const application = await services.applicationService.getApplication(id);

		return json({ application }, { status: 201 });
	} catch (err) {
		console.error('[POST /api/applications]', err);
		return json({ error: 'Failed to create application.' }, { status: 500 });
	}
};
