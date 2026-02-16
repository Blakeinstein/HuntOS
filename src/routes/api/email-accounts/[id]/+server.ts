// src/routes/api/email-accounts/[id]/+server.ts
// Single email account API endpoints

import { json } from '@sveltejs/kit';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

const services = createServices(db);

export async function GET({ params }) {
  try {
    const emailAccount = await services.emailMonitorService.getEmailAccount(Number(params.id));

    if (!emailAccount) {
      return json({ error: 'Email account not found' }, { status: 404 });
    }

    return json(emailAccount);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch email account';
    return json({ error: message }, { status: 500 });
  }
}

export async function PUT({ params, request }) {
  try {
    const data = await request.json();
    await services.emailMonitorService.updateEmailAccount(Number(params.id), data);
    return json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update email account';
    return json({ error: message }, { status: 500 });
  }
}

export async function DELETE({ params }) {
  try {
    await services.emailMonitorService.deleteEmailAccount(Number(params.id));
    return json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete email account';
    return json({ error: message }, { status: 500 });
  }
}
