import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

export const load: PageServerLoad = async ({ params, depends }) => {
  depends(`db:application:${params.id}`);

  const services = createServices(db);
  const applicationId = Number(params.id);

  const [application, history] = await Promise.all([
    services.applicationService.getApplication(applicationId),
    services.applicationService.getApplicationHistory(applicationId)
  ]);

  if (!application) {
    throw error(404, 'Application not found');
  }

  return {
    application,
    history
  };
};
