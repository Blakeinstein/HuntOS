// src/routes/+layout.server.ts
// Root layout server load function

import type { LayoutServerLoad } from './$types';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

export const load: LayoutServerLoad = async ({ depends }) => {
  depends('db:initialize');

  const services = createServices(db);

  // Initialize default swimlanes on first run
  await services.swimlaneService.initializeDefaultSwimlanes();

  // We don't return services or db here to avoid serializing them.
  // They are available in server-side hooks and endpoints directly.
  // This load function is primarily for running initialization logic.
  return {};
};
