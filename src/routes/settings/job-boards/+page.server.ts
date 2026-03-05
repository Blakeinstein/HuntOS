import type { PageServerLoad } from './$types';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

export const load: PageServerLoad = async ({ depends }) => {
	depends('db:job-boards');
	depends('app:scraper-enabled');

	const services = createServices(db);
	const jobBoards = await services.jobBoardService.getJobBoards();
	const scraperEnabled = services.appSettingsService.scraperEnabled;

	return { jobBoards, scraperEnabled };
};
