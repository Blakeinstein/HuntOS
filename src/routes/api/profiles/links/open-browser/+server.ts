// src/routes/api/profiles/links/open-browser/+server.ts
// Opens a URL in the user's running agent-browser session via CDP.
// Used by the LinksManager to guide users through the LinkedIn login flow.

import { json } from '@sveltejs/kit';
import { browserExec } from '$lib/mastra/tools/browser/exec';

/**
 * POST /api/profiles/links/open-browser
 * Body: { url: string }
 *
 * Opens the given URL in the user's agent-browser (Chrome) session so they
 * can authenticate before retrying a summarise job.
 */
export async function POST({ request }) {
	try {
		const body = await request.json();
		const { url } = body ?? {};

		if (!url || typeof url !== 'string') {
			return json({ error: 'Missing required field: url' }, { status: 400 });
		}

		// Basic URL validation
		try {
			new URL(url);
		} catch {
			return json({ error: 'Invalid URL' }, { status: 400 });
		}

		const result = await browserExec(['open', url], { timeout: 15_000 });

		if (!result.success) {
			return json(
				{
					error: `Failed to open browser: ${result.stderr || 'Unknown error'}`,
					detail: result.stderr
				},
				{ status: 500 }
			);
		}

		return json({ success: true, message: `Opened ${url} in browser` });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to open browser';
		return json({ error: message }, { status: 500 });
	}
}
