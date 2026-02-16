// src/routes/api/email-accounts/[id]/sync/+server.ts
// Email sync API endpoint

import { json } from '@sveltejs/kit';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

const services = createServices(db);

export async function POST({ params }) {
  try {
    const messages = await services.emailMonitorService.syncEmails(Number(params.id));
    return json(messages);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to sync emails';
    return json({ error: message }, { status: 500 });
  }
}
