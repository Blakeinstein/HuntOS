// src/routes/api/applications/[id]/pipeline/cancel/+server.ts
// Cancel a running pipeline for an application.
//
// POST /api/applications/:id/pipeline/cancel
//
// Marks the active pipeline run as 'cancelled'. The executor checks
// for cancellation at cooperative checkpoints and stops cleanly.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

export const POST: RequestHandler = async ({ params }) => {
	const services = createServices(db);
	const applicationId = Number(params.id);

	if (Number.isNaN(applicationId) || applicationId <= 0) {
		return json({ error: 'Invalid application ID' }, { status: 400 });
	}

	// Find the latest running pipeline for this application
	const latestRun =
		services.applicationPipelineService.getLatestByApplicationId(applicationId);

	if (!latestRun) {
		return json({ error: 'No pipeline run found for this application' }, { status: 404 });
	}

	if (latestRun.status !== 'running' && latestRun.status !== 'pending') {
		return json(
			{
				error: `Pipeline is not running (current status: ${latestRun.status})`
			},
			{ status: 400 }
		);
	}

	const cancelled = services.applicationPipelineService.cancel(latestRun.id);

	if (!cancelled) {
		return json({ error: 'Failed to cancel pipeline' }, { status: 500 });
	}

	return json({
		success: true,
		pipelineRunId: latestRun.id,
		message: 'Pipeline cancellation requested'
	});
};
