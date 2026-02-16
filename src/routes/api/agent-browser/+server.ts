// src/routes/api/agent-browser/+server.ts
// Browser automation API endpoints

import { json } from '@sveltejs/kit';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

const services = createServices(db);

export async function POST({ request }) {
  try {
    const { action, applicationId, url, selector, value } = await request.json();

    let result;

    switch (action) {
      case 'launch':
        await services.browserAgentService.launchBrowser();
        result = { success: true };
        break;
      case 'navigate':
        if (!url) return json({ error: 'URL is required for navigate action' }, { status: 400 });
        await services.browserAgentService.navigateToApplication(url);
        result = { success: true };
        break;
      case 'fill':
        if (!selector || value === undefined) return json({ error: 'Selector and value are required for fill action' }, { status: 400 });
        const filled = await services.browserAgentService.fillField(selector, value);
        result = { success: filled };
        break;
      case 'submit':
        const submitted = await services.browserAgentService.submitApplication();
        result = { success: submitted };
        break;
      case 'fill-form':
        if (!applicationId) return json({ error: 'applicationId is required for fill-form action' }, { status: 400 });
        result = await services.browserAgentService.fillApplicationForm(Number(applicationId));
        break;
      case 'screenshot':
        result = { screenshot: await services.browserAgentService.takeScreenshot() };
        break;
      default:
        return json({ error: 'Unknown action' }, { status: 400 });
    }

    return json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Browser automation failed';
    return json({ error: message }, { status: 500 });
  }
}
