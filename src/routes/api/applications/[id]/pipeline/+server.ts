// src/routes/api/applications/[id]/pipeline/+server.ts
// Poll pipeline run status and list resources for an application.
//
// GET /api/applications/:id/pipeline
//   Returns the latest pipeline run (if any) plus all resources.
//
// Query params:
//   ?runId=123  — fetch a specific pipeline run instead of the latest.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

export const GET: RequestHandler = async ({ params, url }) => {
	const services = createServices(db);
	const applicationId = Number(params.id);

	if (Number.isNaN(applicationId) || applicationId <= 0) {
		return json({ error: 'Invalid application ID' }, { status: 400 });
	}

	const runIdParam = url.searchParams.get('runId');

	try {
		// Get the pipeline run
		let pipelineRun;
		if (runIdParam) {
			const runId = Number(runIdParam);
			if (Number.isNaN(runId) || runId <= 0) {
				return json({ error: 'Invalid runId parameter' }, { status: 400 });
			}
			pipelineRun = services.applicationPipelineService.getById(runId);
		} else {
			pipelineRun =
				services.applicationPipelineService.getLatestByApplicationId(applicationId);
		}

		// Get all pipeline runs for this application
		const allRuns = services.applicationPipelineService.getByApplicationId(applicationId);

		// Get all resources for this application
		const resources = services.applicationResourceService.getByApplicationId(applicationId);

		return json({
			pipelineRun: pipelineRun ?? null,
			allRuns,
			resources
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to fetch pipeline status';
		return json({ error: message }, { status: 500 });
	}
};
