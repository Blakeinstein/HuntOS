// src/routes/api/admin/scheduler/+server.ts
// Admin API for viewing scheduler status and controlling individual jobs.
//
// GET  /api/admin/scheduler           → list all jobs with status/metrics
// POST /api/admin/scheduler           → control actions (start, stop, pause, resume, trigger, startAll, stopAll)
//
// POST body: { action: string, job?: string }

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { services } from '$lib/mastra';

const VALID_ACTIONS = ['start', 'stop', 'pause', 'resume', 'trigger', 'startAll', 'stopAll'] as const;
type Action = (typeof VALID_ACTIONS)[number];

export const GET: RequestHandler = async () => {
	const { schedulerService } = services;

	try {
		const jobs = schedulerService.getAllJobStatuses();
		const initialized = schedulerService.isInitialized();

		return json({
			initialized,
			jobs
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to get scheduler status';
		return json({ error: message }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request }) => {
	const { schedulerService } = services;

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const action = body.action as string | undefined;
	const jobName = body.job as string | undefined;

	if (!action || !VALID_ACTIONS.includes(action as Action)) {
		return json(
			{ error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` },
			{ status: 400 }
		);
	}

	try {
		switch (action as Action) {
			case 'startAll':
				await schedulerService.start();
				return json({ ok: true, message: 'All jobs started' });

			case 'stopAll':
				await schedulerService.stop();
				return json({ ok: true, message: 'All jobs stopped' });

			case 'start':
			case 'stop':
			case 'pause':
			case 'resume':
			case 'trigger': {
				if (!jobName) {
					return json(
						{ error: `"job" is required for action "${action}"` },
						{ status: 400 }
					);
				}

				const knownJobs = schedulerService.getJobNames();
				if (!knownJobs.includes(jobName)) {
					return json(
						{ error: `Unknown job: "${jobName}". Known jobs: ${knownJobs.join(', ')}` },
						{ status: 404 }
					);
				}

				switch (action) {
					case 'start':
						await schedulerService.startJob(jobName);
						break;
					case 'stop':
						await schedulerService.stopJob(jobName);
						break;
					case 'pause':
						await schedulerService.pauseJob(jobName);
						break;
					case 'resume':
						await schedulerService.resumeJob(jobName);
						break;
					case 'trigger':
						await schedulerService.triggerJob(jobName);
						break;
				}

				const status = schedulerService.getJobStatus(jobName);
				return json({ ok: true, message: `Job "${jobName}" action "${action}" completed`, status });
			}

			default:
				return json({ error: `Unhandled action: ${action}` }, { status: 400 });
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Scheduler action failed';
		return json({ error: message }, { status: 500 });
	}
};
