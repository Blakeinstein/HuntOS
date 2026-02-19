import type { PageServerLoad } from './$types';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

export const load: PageServerLoad = async ({ depends }) => {
	depends('db:profile');
	depends('db:resume-templates');

	const services = createServices(db);

	const profile = await services.profileService.getProfile();
	const completeness = await services.profileService.getCompletenessScore();
	const templates = services.resumeTemplateService.list();

	return {
		hasProfile: completeness > 20,
		completeness,
		profileName: (profile.name as string) ?? '',
		templates
	};
};
