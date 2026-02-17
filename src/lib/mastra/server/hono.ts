// src/lib/mastra/server/hono.ts
// Minimal Hono app that registers all Mastra SERVER_ROUTES so Studio can connect.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Hono } from 'hono';
import { SERVER_ROUTES } from '@mastra/server/server-adapter';
import type { ServerRoute } from '@mastra/server/server-adapter';
import { RequestContext } from '@mastra/core/request-context';
import { mastra } from '$lib/mastra';

type HonoEnv = {
	Variables: {
		mastra: typeof mastra;
		requestContext: RequestContext;
	};
};

const app = new Hono<HonoEnv>();

// Attach mastra context to every request
app.use('*', async (c, next) => {
	c.set('mastra', mastra);
	c.set('requestContext', new RequestContext());
	await next();
});

function registerRoute(route: ServerRoute<any, any, any>) {
	const method = route.method.toLowerCase() as 'get' | 'post' | 'delete' | 'patch' | 'put' | 'all';
	const path = `/api${route.path}`;

	app[method](path, async (c) => {
		try {
			// Extract URL params
			const urlParams: Record<string, string> = c.req.param() ?? {};

			// Extract query params
			const rawQuery: Record<string, string> = {};
			const url = new URL(c.req.url);
			url.searchParams.forEach((value, key) => {
				rawQuery[key] = value;
			});

			// Parse query params through schema if available
			let queryParams: Record<string, unknown> = rawQuery;
			if (route.queryParamSchema) {
				try {
					queryParams = route.queryParamSchema.parse(rawQuery) as Record<string, unknown>;
				} catch {
					queryParams = rawQuery;
				}
			}

			// Parse body for non-GET/DELETE requests
			let body: unknown = {};
			if (c.req.method !== 'GET' && c.req.method !== 'DELETE') {
				try {
					body = await c.req.json();
				} catch {
					body = {};
				}
			}

			// Merge request context from body if present
			const requestContext = c.get('requestContext');
			if (
				body &&
				typeof body === 'object' &&
				'requestContext' in (body as Record<string, unknown>)
			) {
				const bodyCtx = (body as Record<string, unknown>).requestContext;
				if (bodyCtx && typeof bodyCtx === 'object') {
					for (const [key, value] of Object.entries(bodyCtx as Record<string, unknown>)) {
						requestContext.set(key, value);
					}
				}
			}

			// Build handler params
			const handlerParams = {
				...urlParams,
				...queryParams,
				...(typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}),
				mastra: c.get('mastra'),
				requestContext,
				abortSignal: c.req.raw.signal
			};

			const result = await route.handler(handlerParams as any);

			// Handle different response types
			switch (route.responseType) {
				case 'json':
					return c.json(result as Record<string, unknown>);

				case 'stream': {
					const streamResult = result as any;
					const isSSE = route.streamFormat === 'sse';

					if (isSSE) {
						c.header('Content-Type', 'text/event-stream');
						c.header('Cache-Control', 'no-cache');
						c.header('Connection', 'keep-alive');
					} else {
						c.header('Content-Type', 'text/plain; charset=utf-8');
						c.header('Transfer-Encoding', 'chunked');
					}

					// If the result is a ReadableStream
					if (streamResult instanceof ReadableStream) {
						return new Response(streamResult, {
							headers: Object.fromEntries(c.res.headers.entries())
						});
					}

					// If it's a Response-like object
					if (streamResult instanceof Response) {
						return streamResult;
					}

					// If it has a fullStream property (Mastra stream return)
					if (streamResult?.fullStream) {
						return new Response(streamResult.fullStream as ReadableStream, {
							headers: {
								'Content-Type': isSSE ? 'text/event-stream' : 'text/plain; charset=utf-8',
								'Cache-Control': 'no-cache',
								Connection: 'keep-alive'
							}
						});
					}

					// Fallback: return as JSON
					return c.json(streamResult as Record<string, unknown>);
				}

				case 'datastream-response': {
					// This is already a Response object
					if (result instanceof Response) {
						return result;
					}
					return c.json(result as Record<string, unknown>);
				}

				default:
					return c.json(result as Record<string, unknown>);
			}
		} catch (error: unknown) {
			const err = error as { status?: number; details?: { status?: number }; message?: string };
			const status = err.status ?? err.details?.status ?? 500;
			return c.json({ error: err.message ?? 'Internal Server Error' }, { status: status as 500 });
		}
	});
}

// Register all Mastra server routes
for (const route of SERVER_ROUTES) {
	// Skip MCP routes — not needed for Studio
	if (route.responseType === 'mcp-http' || route.responseType === 'mcp-sse') {
		continue;
	}
	registerRoute(route);
}

export { app as mastraHono };
