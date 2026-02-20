import type { PageServerLoad } from './$types';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

export const load: PageServerLoad = async () => {
	const services = createServices(db);

	const resumeFormat = services.appSettingsService.resumeFormat;

	return {
		resumeFormat
	};
};
