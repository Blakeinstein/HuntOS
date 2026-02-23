// src/routes/api/applications/[id]/apply/+server.ts
// Trigger the apply pipeline for an application.
//
// POST /api/applications/:id/apply
//   Body (optional): { "resumeFrom": "research" | "resume" | "apply" }
//
// The pipeline runs in the background (fire-and-forget) so the response
// returns immediately with the pipeline run ID. The frontend polls
// GET /api/applications/:id/pipeline to track progress.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServices } from '$lib/services';
import { db } from '$lib/db';
import { PIPELINE_STEPS } from '$lib/services/services/applicationPipeline';
import type { PipelineStep } from '$lib/services/services/applicationPipeline';

export const POST: RequestHandler = async ({ params, request }) => {
	const services = createServices(db);
	const applicationId = Number(params.id);

	if (Number.isNaN(applicationId) || applicationId <= 0) {
		return json({ error: 'Invalid application ID' }, { status: 400 });
	}

	// Parse optional body for resumeFrom
	let resumeFrom: PipelineStep | undefined;
	try {
		const body = await request.json().catch(() => ({}));
		if (body && typeof body === 'object' && 'resumeFrom' in body && body.resumeFrom) {
			const step = body.resumeFrom as string;
			if (!PIPELINE_STEPS.includes(step as PipelineStep)) {
				return json(
					{
						error: `Invalid resumeFrom step: "${step}". Valid steps: ${PIPELINE_STEPS.join(', ')}`
					},
					{ status: 400 }
				);
			}
			resumeFrom = step as PipelineStep;
		}
	} catch {
		// No body or invalid JSON — that's fine, just run from the start
	}

	// Check the application exists
	const application = await services.applicationService.getApplication(applicationId);
	if (!application) {
		return json({ error: 'Application not found' }, { status: 404 });
	}

	// Allow retry from both Backlog and Action Required swimlanes.
	// When a pipeline fails the app is moved to "Action Required", and the
	// user should be able to retry without manually moving it back first.
	const swimlane = application.swimlane_name.toLowerCase();
	if (swimlane !== 'backlog' && swimlane !== 'action required') {
		return json(
			{
				error: `Application must be in Backlog or Action Required to apply (current: ${application.swimlane_name})`
			},
			{ status: 400 }
		);
	}

	// Check for existing active pipeline
	if (services.applicationPipelineService.hasActiveRun(applicationId)) {
		return json({ error: 'A pipeline is already running for this application' }, { status: 409 });
	}

	// If the application is in "Action Required", move it back to Backlog
	// before starting the pipeline (the executor validates Backlog status).
	if (swimlane === 'action required') {
		const swimlanes = await services.swimlaneService.getSwimlanes();
		const backlog = swimlanes.find((s) => s.name.toLowerCase() === 'backlog');
		if (backlog) {
			await services.applicationService.moveApplication(
				applicationId,
				backlog.id,
				resumeFrom
					? `Moved back to Backlog for pipeline resume from ${resumeFrom}`
					: 'Moved back to Backlog for pipeline retry',
				'system'
			);
		}
	}

	// ── Create the pipeline run synchronously ───────────────────────
	// We create the run HERE instead of inside the executor so that
	// it exists in the DB before we return the response. The executor's
	// execute() is async and hits several `await` calls before it would
	// create the run, causing a race condition where getLatestByApplicationId()
	// would find nothing (or an old completed/failed run).
	const pipelineRun = services.applicationPipelineService.create(applicationId);

	// If resuming, pre-mark earlier steps as completed
	if (resumeFrom) {
		for (const step of PIPELINE_STEPS) {
			if (step === resumeFrom) break;
			services.applicationPipelineService.completeStep(pipelineRun.id, step);
			services.applicationPipelineService.addStepLog(
				pipelineRun.id,
				step,
				'progress',
				`Skipped (resuming from ${resumeFrom})`
			);
		}
	}

	// Fire-and-forget: hand the pre-created run to the executor for
	// background processing. The executor will pick up the existing run
	// instead of creating a new one.
	const executor = services.applyPipelineExecutor;
	executor.executeWithRun(applicationId, pipelineRun.id, { resumeFrom }).catch((err) => {
		console.error('[ApplyPipeline] Background execution error:', err);
	});

	return json({
		success: true,
		pipelineRunId: pipelineRun.id,
		resumeFrom: resumeFrom ?? null,
		message: resumeFrom ? `Apply pipeline resumed from ${resumeFrom}` : 'Apply pipeline started'
	});
};
