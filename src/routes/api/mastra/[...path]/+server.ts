// src/routes/api/mastra/[...path]/+server.ts
// Catch-all route that proxies requests to the internal Mastra Hono app
// so that Mastra Studio can connect to the SvelteKit server for observability.

import type { RequestHandler } from './$types';
import { mastraHono } from '$lib/mastra/server/hono';

const handler: RequestHandler = async ({ request, params }) => {
	const url = new URL(request.url);
	const apiPath = `/api/${params.path}`;
	const proxiedUrl = new URL(apiPath + url.search, url.origin);

	const proxiedRequest = new Request(proxiedUrl, {
		method: request.method,
		headers: request.headers,
		body: request.body,
		duplex: 'half',
		signal: request.signal,
	} as RequestInit);

	return mastraHono.fetch(proxiedRequest);
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
