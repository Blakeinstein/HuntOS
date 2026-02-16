import type { PageServerLoad } from './$types';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

export const load: PageServerLoad = async ({ depends }) => {
  depends('db:job-boards');

  const services = createServices(db);
  const jobBoards = await services.jobBoardService.getJobBoards();

  return { jobBoards };
};
