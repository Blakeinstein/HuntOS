import type { PageServerLoad } from './$types';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

export const load: PageServerLoad = async ({ depends }) => {
	depends('db:profile');
	depends('db:documents');

	const services = createServices(db);

	const profile = await services.profileService.getProfile();
	const incompleteFields = await services.profileService.getIncompleteFields();
	const completeness = await services.profileService.getCompletenessScore();
	const documents = services.documentService.listDocuments();
	const profileLinks = await services.profileService.getProfileLinks();

	return {
		profile,
		incompleteFields,
		completeness,
		documents,
		profileLinks
	};
};
