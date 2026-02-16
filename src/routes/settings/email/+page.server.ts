import type { PageServerLoad } from './$types';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

export const load: PageServerLoad = async ({ depends }) => {
  depends('db:email-accounts');

  const services = createServices(db);
  const emailAccounts = await services.emailMonitorService.getEmailAccounts();

  return { emailAccounts };
};
