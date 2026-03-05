import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
	const res = await fetch('/api/settings/automation');
	const data = await res.json();

	return {
		settings: data.settings ?? {
			autoApplyEnabled: false,
			autoApplyCron: '0 */5 * * * *',
			scraperEnabled: true,
			emailSyncCron: '0 */30 * * * *',
			auditCleanupEnabled: false,
			auditCleanupCron: '0 0 3 * * *',
			agentMaxStepsPerIteration: 30,
			agentTotalStepBudget: 80,
			agentMaxIterations: 5
		},
		scheduler: data.scheduler ?? {
			initialized: false,
			jobs: []
		}
	};
};
