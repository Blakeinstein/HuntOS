// src/routes/applications/+layout.server.ts
// Applications layout load function

import type { LayoutServerLoad } from './$types';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

export const load: LayoutServerLoad = async ({ depends }) => {
  depends('db:applications');
  depends('db:swimlanes');

  const services = createServices(db);

  const [applications, swimlanes] = await Promise.all([
    services.applicationService.getApplications(),
    services.swimlaneService.getSwimlanes()
  ]);

  return {
    applications,
    swimlanes
  };
};
