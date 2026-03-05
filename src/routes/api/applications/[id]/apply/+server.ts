// src/routes/api/applications/[id]/apply/+server.ts
// Trigger the apply pipeline for an application.
//
// POST /api/applications/:id/apply
//   Body (optional): {
//     "resumeFrom": "research" | "resume" | "apply",
//     "action": "queue" | "cancel-and-start"   ← only needed when another pipeline is running
//   }
//
// Because the browser agent is a shared singleton, only ONE pipeline can
// run at a time across all applications.
//
// When another pipeline is already running the server returns 409 with:
//   { conflict: true, activeApplicationId, activeRunId, activeCompany, activeTitle }
//
// The caller can then re-POST with `action`:
//   "cancel-and-start" — cancels the active run and starts this one immediately.
//   "queue"            — not handled server-side; the UI queues it locally and
//                        polls until the active run finishes, then re-POSTs.
//
// The pipeline runs in the background (fire-and-forget) so the response
// returns immediately with the pipeline run ID. The frontend polls
// GET /api/applications/:id/pipeline to track progress.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { services } from '$lib/mastra';
import { PIPELINE_STEPS } from '$lib/services/services/applicationPipeline';
import type { PipelineStep } from '$lib/services/services/applicationPipeline';

export const POST: RequestHandler = async ({ params, request }) => {
	const applicationId = Number(params.id);

	if (Number.isNaN(applicationId) || applicationId <= 0) {
		return json({ error: 'Invalid application ID' }, { status: 400 });
	}

	// Parse optional body
	let resumeFrom: PipelineStep | undefined;
	let action: 'queue' | 'cancel-and-start' | undefined;

	try {
		const body = await request.json().catch(() => ({}));
		if (body && typeof body === 'object') {
			if ('resumeFrom' in body && body.resumeFrom) {
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

			if ('action' in body && body.action) {
				const act = body.action as string;
				if (act !== 'queue' && act !== 'cancel-and-start') {
					return json(
						{ error: `Invalid action: "${act}". Valid actions: queue, cancel-and-start` },
						{ status: 400 }
					);
				}
				action = act;
			}
		}
	} catch {
		// No body or invalid JSON — fine, run from start with no action
	}

	// Check the application exists
	const application = await services.applicationService.getApplication(applicationId);
	if (!application) {
		return json({ error: 'Application not found' }, { status: 404 });
	}

	// Allow triggering from Backlog and Action Required only.
	const swimlane = application.swimlane_name.toLowerCase();
	if (swimlane !== 'backlog' && swimlane !== 'action required') {
		return json(
			{
				error: `Application must be in Backlog or Action Required to apply (current: ${application.swimlane_name})`
			},
			{ status: 400 }
		);
	}

	// ── Global single-run enforcement ───────────────────────────────────
	// The browser agent is a shared singleton — only one pipeline at a time.
	const globalActiveRun = services.applicationPipelineService.getGlobalActiveRun();

	if (globalActiveRun && globalActiveRun.application_id !== applicationId) {
		// Another application's pipeline is running.
		if (action === 'cancel-and-start') {
			// Cancel the active run, then fall through to start this one.
			services.applicationPipelineService.cancel(globalActiveRun.id);
		} else {
			// Return a conflict response so the UI can ask the user what to do.
			const activeApplication = await services.applicationService.getApplication(
				globalActiveRun.application_id
			);

			return json(
				{
					error: 'Another pipeline is already running',
					conflict: true,
					activeApplicationId: globalActiveRun.application_id,
					activeRunId: globalActiveRun.id,
					activeCompany: activeApplication?.company ?? 'Unknown',
					activeTitle: activeApplication?.title ?? 'Unknown'
				},
				{ status: 409 }
			);
		}
	}

	// ── Per-application active run check ────────────────────────────────
	// Covers the edge case where the same application already has an active run
	// (e.g. user double-clicks Apply, or a globalActiveRun was for this very app).
	if (services.applicationPipelineService.hasActiveRun(applicationId)) {
		return json({ error: 'A pipeline is already running for this application' }, { status: 409 });
	}

	// If the application is in "Action Required", move it back to Backlog first
	// (the executor validates Backlog status).
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

	// ── Create the pipeline run synchronously ───────────────────────────
	// We create the run HERE so it exists in the DB before we return the
	// response — avoids a race condition where the polling endpoint would
	// find nothing right after the POST.
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

	// Fire-and-forget background execution
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
