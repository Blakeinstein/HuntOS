// src/routes/api/email-accounts/+server.ts
// Email accounts API endpoints

import { json } from '@sveltejs/kit';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

const services = createServices(db);

export async function GET() {
  try {
    const emailAccounts = await services.emailMonitorService.getEmailAccounts();
    return json(emailAccounts);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch email accounts';
    return json({ error: message }, { status: 500 });
  }
}

export async function POST({ request }) {
  try {
    const data = await request.json();
    const id = await services.emailMonitorService.createEmailAccount(data);
    return json({ id }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create email account';
    return json({ error: message }, { status: 500 });
  }
}
