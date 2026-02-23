import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

export const load: PageServerLoad = async ({ params, depends }) => {
	depends(`db:application:${params.id}`);

	const services = createServices(db);
	const applicationId = Number(params.id);

	const [application, history, pipelineRuns, resources] = await Promise.all([
		services.applicationService.getApplication(applicationId),
		services.applicationService.getApplicationHistory(applicationId),
		Promise.resolve(services.applicationPipelineService.getByApplicationId(applicationId)),
		Promise.resolve(services.applicationResourceService.getByApplicationId(applicationId))
	]);

	if (!application) {
		throw error(404, 'Application not found');
	}

	const latestPipelineRun = pipelineRuns.length > 0 ? pipelineRuns[0] : null;

	// Load step logs for the latest pipeline run (if any)
	const stepLogs = latestPipelineRun
		? services.applicationPipelineService.getStepLogs(latestPipelineRun.id)
		: [];

	return {
		application,
		history,
		pipelineRuns,
		latestPipelineRun,
		stepLogs,
		resources
	};
};
