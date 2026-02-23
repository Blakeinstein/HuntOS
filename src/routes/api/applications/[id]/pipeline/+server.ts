// src/routes/api/applications/[id]/pipeline/+server.ts
// Poll pipeline run status, step logs, and resources for an application.
//
// GET /api/applications/:id/pipeline
//   Returns the latest pipeline run (if any), step logs, and all resources.
//
// Query params:
//   ?runId=123      — fetch a specific pipeline run instead of the latest.
//   ?afterLogId=456 — only return step logs with id > 456 (incremental polling).

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
	const afterLogIdParam = url.searchParams.get('afterLogId');

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
			pipelineRun = services.applicationPipelineService.getLatestByApplicationId(applicationId);
		}

		// Get all pipeline runs for this application
		const allRuns = services.applicationPipelineService.getByApplicationId(applicationId);

		// Get step logs for the current run
		let stepLogs: ReturnType<typeof services.applicationPipelineService.getStepLogs> = [];
		if (pipelineRun) {
			if (afterLogIdParam) {
				const afterLogId = Number(afterLogIdParam);
				if (!Number.isNaN(afterLogId) && afterLogId >= 0) {
					stepLogs = services.applicationPipelineService.getStepLogsSince(
						pipelineRun.id,
						afterLogId
					);
				} else {
					stepLogs = services.applicationPipelineService.getStepLogs(pipelineRun.id);
				}
			} else {
				stepLogs = services.applicationPipelineService.getStepLogs(pipelineRun.id);
			}
		}

		// Get all resources for this application
		const resources = services.applicationResourceService.getByApplicationId(applicationId);

		return json({
			pipelineRun: pipelineRun ?? null,
			allRuns,
			stepLogs,
			resources
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to fetch pipeline status';
		return json({ error: message }, { status: 500 });
	}
};
