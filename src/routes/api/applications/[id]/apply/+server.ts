// src/routes/api/applications/[id]/apply/+server.ts
// Trigger the apply pipeline for an application.
//
// POST /api/applications/:id/apply
//
// The pipeline runs in the background (fire-and-forget) so the response
// returns immediately with the pipeline run ID. The frontend polls
// GET /api/applications/:id/pipeline to track progress.

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

	// Check the application exists
	const application = await services.applicationService.getApplication(applicationId);
	if (!application) {
		return json({ error: 'Application not found' }, { status: 404 });
	}

	// Verify application is in Backlog
	if (application.swimlane_name.toLowerCase() !== 'backlog') {
		return json(
			{
				error: `Application must be in Backlog to apply (current: ${application.swimlane_name})`
			},
			{ status: 400 }
		);
	}

	// Check for existing active pipeline
	if (services.applicationPipelineService.hasActiveRun(applicationId)) {
		return json(
			{ error: 'A pipeline is already running for this application' },
			{ status: 409 }
		);
	}

	// Fire-and-forget: start the pipeline in the background.
	// We don't await here so the HTTP response returns immediately.
	// The frontend will poll the pipeline status endpoint.
	const executor = services.applyPipelineExecutor;
	const runPromise = executor.execute(applicationId);

	// We need the pipeline run ID to return to the client, so we
	// create the run record synchronously and let the executor pick it up.
	// However, the executor.execute() already creates the run internally,
	// so we grab the latest run after a tiny delay or just get it now.
	const latestRun = services.applicationPipelineService.getLatestByApplicationId(applicationId);

	// If we already have a run (executor.create is synchronous in the DB),
	// return its ID. Otherwise create a pending placeholder.
	let pipelineRunId: number;

	if (latestRun && latestRun.status === 'running') {
		pipelineRunId = latestRun.id;
	} else {
		// The executor hasn't created the run yet (race). Create a pending run
		// and the executor will use hasActiveRun() to detect it.
		const run = services.applicationPipelineService.create(applicationId);
		pipelineRunId = run.id;

		// Now start the executor in background (it will detect the existing run
		// and skip creating a duplicate).
		runPromise.catch((err) => {
			console.error('[ApplyPipeline] Background execution failed:', err);
		});
	}

	// Ensure the background promise errors don't crash the process
	runPromise.catch((err) => {
		console.error('[ApplyPipeline] Background execution error:', err);
	});

	return json({
		success: true,
		pipelineRunId,
		message: 'Apply pipeline started'
	});
};
