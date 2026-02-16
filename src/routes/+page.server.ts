// src/routes/+page.server.ts
// Root page server load function

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  throw redirect(302, '/applications');
};
