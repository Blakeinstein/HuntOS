import type { PageServerLoad } from './$types';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

export const load: PageServerLoad = async ({ depends, url }) => {
	depends('db:profile');
	depends('db:resume-templates');
	depends('db:resume-history');
	depends('db:settings');

	const services = createServices(db);

	const resumeFormat = services.appSettingsService.resumeFormat;
	const profile = await services.profileService.getProfile();
	const completeness = await services.profileService.getCompletenessScore();
	const templates = services.resumeTemplateService.list();

	// History query params
	const search = url.searchParams.get('search') ?? undefined;
	const limitParam = url.searchParams.get('limit');
	const offsetParam = url.searchParams.get('offset');
	const limit = limitParam ? Math.min(Math.max(Number(limitParam) || 20, 1), 200) : 20;
	const offset = offsetParam ? Math.max(Number(offsetParam) || 0, 0) : 0;

	const history = services.resumeHistoryService.query({ search, limit, offset });

	return {
		hasProfile: completeness > 20,
		completeness,
		profileName: (profile.name as string) ?? '',
		templates,
		history,
		resumeFormat
	};
};
