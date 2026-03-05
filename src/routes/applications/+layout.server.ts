// src/routes/applications/+layout.server.ts
// Applications layout load function

import type { LayoutServerLoad } from './$types';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

export const load: LayoutServerLoad = async ({ depends }) => {
	depends('db:applications');
	depends('db:swimlanes');
	depends('db:pipelines');

	const services = createServices(db);

	const [applications, swimlanes] = await Promise.all([
		services.applicationService.getApplications(),
		services.swimlaneService.getSwimlanes()
	]);

	// Attach the latest active pipeline run (if any) to each application so
	// the Kanban card can show a spinner for in-flight jobs.
	const applicationsWithPipeline = applications.map((app) => {
		const latestRun = services.applicationPipelineService.getLatestByApplicationId(app.id);
		const hasActiveRun =
			latestRun !== null && (latestRun.status === 'running' || latestRun.status === 'pending');

		return {
			...app,
			active_pipeline_run: hasActiveRun ? latestRun : null
		};
	});

	return {
		applications: applicationsWithPipeline,
		swimlanes
	};
};
