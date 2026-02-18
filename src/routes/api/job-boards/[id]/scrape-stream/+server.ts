// src/routes/api/job-boards/[id]/scrape-stream/+server.ts
//
// Split endpoint for scrape streaming:
//
//   POST /api/job-boards/:id/scrape-stream
//     — Triggers a new scrape run. Returns { runId } immediately.
//       The scrape executes in the background, pushing events into
//       the server-side ScrapeRunManager.
//
//   GET /api/job-boards/:id/scrape-stream
//     — Proper SSE endpoint for EventSource. Streams events for the
//       active run on this board. Supports Last-Event-ID for replay.
//       Sends keep-alive pings every 15s. Closes when the run finishes.

import type { RequestHandler } from './$types';
import { RequestContext } from '@mastra/core/request-context';
import { services, mastra, subAgentRegistry } from '$lib/mastra';
import { logger } from '$lib/mastra/logger';
import {
	scrapeResultSchema,
	type ScrapeResult,
	type JobBoardRequestContext,
	type PaginationContext
} from '$lib/mastra/agents/job-board-agent/index';
import type { PaginationState } from '$lib/services/services/jobBoard';
import {
	createStepEvent,
	getToolLabel,
	truncate,
	type AgentStepEvent,
	type ScrapeStartPayload,
	type ToolCallPayload,
	type ToolResultPayload,
	type ToolErrorPayload,
	type TextDeltaPayload,
	type StepStartPayload,
	type StepFinishPayload,
	type ScrapeFinishPayload,
	type ScrapeErrorPayload
} from '$lib/services/services/agentStream.types';
import {
	scrapeRunManager,
	formatSseFrame,
	formatSseComment
} from '$lib/services/services/scrapeRunManager';

// ── JSON extraction helpers (mirrored from jobBoardScraper.ts) ──────

function extractJson(text: string): unknown {
	const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
	if (fenceMatch) {
		try {
			return JSON.parse(fenceMatch[1].trim());
		} catch {
			/* fall through */
		}
	}
	const firstBrace = text.indexOf('{');
	const lastBrace = text.lastIndexOf('}');
	if (firstBrace !== -1 && lastBrace > firstBrace) {
		try {
			return JSON.parse(text.slice(firstBrace, lastBrace + 1));
		} catch {
			/* fall through */
		}
	}
	const firstBracket = text.indexOf('[');
	const lastBracket = text.lastIndexOf(']');
	if (firstBracket !== -1 && lastBracket > firstBracket) {
		try {
			return JSON.parse(text.slice(firstBracket, lastBracket + 1));
		} catch {
			/* fall through */
		}
	}
	return undefined;
}

function parseAgentResponse(text: string): ScrapeResult | null {
	const raw = extractJson(text);
	if (raw === undefined) return null;
	const parsed = scrapeResultSchema.safeParse(raw);
	return parsed.success ? parsed.data : null;
}

// ── POST: Trigger a scrape run ──────────────────────────────────────

export const POST: RequestHandler = async ({ params }) => {
	const jobBoardId = Number(params.id);

	if (Number.isNaN(jobBoardId)) {
		return new Response(JSON.stringify({ error: 'Invalid job board ID' }), {
			status: 400,
			headers: { 'content-type': 'application/json' }
		});
	}

	if (!services.jobBoardScraperService) {
		return new Response(JSON.stringify({ error: 'Scraper service not initialized' }), {
			status: 503,
			headers: { 'content-type': 'application/json' }
		});
	}

	// Reject if a run is already active for this board
	if (scrapeRunManager.isRunning(jobBoardId)) {
		const existing = scrapeRunManager.getRun(jobBoardId);
		return new Response(
			JSON.stringify({
				error: 'A scrape is already running for this board',
				runId: existing?.runId
			}),
			{ status: 409, headers: { 'content-type': 'application/json' } }
		);
	}

	// --- Load job board + profile so we can fail fast ---
	const jobBoard = await services.jobBoardService.getJobBoard(jobBoardId);
	if (!jobBoard) {
		return new Response(JSON.stringify({ error: 'Job board not found' }), {
			status: 404,
			headers: { 'content-type': 'application/json' }
		});
	}

	// Resolve pagination state
	const paginationState: PaginationState =
		await services.jobBoardService.resolvePaginationState(jobBoardId);

	const paginationContext: PaginationContext = {
		resume_page: paginationState.resumePage,
		resume_page_url: paginationState.resumePageUrl,
		max_listings: paginationState.maxListings
	};

	const targetUrl = paginationState.resumePageUrl ?? jobBoard.base_url;

	// Always resolve the sub-agent against the *base* URL so that pagination
	// query params (e.g. &start=50) don't accidentally cause a routing mismatch.
	const entry = subAgentRegistry.resolve(jobBoard.base_url);
	const agentId = entry?.agentId ?? 'job-board-agent.generic';
	const detectedBoard = entry?.board ?? 'generic';

	const profile = await services.profileService.getProfile();
	const profileJson = JSON.stringify(profile, null, 2);

	// Register the run in the manager (synchronous)
	const run = scrapeRunManager.createRun(jobBoardId, jobBoard.name);

	// Fire off the scrape in the background (don't await it)
	executeScrape({
		jobBoardId,
		jobBoard,
		targetUrl,
		agentId,
		detectedBoard,
		profileJson,
		paginationContext
	}).catch((err) => {
		logger.error('[scrape-stream] background execution threw unexpectedly', {
			jobBoardId,
			error: err instanceof Error ? err.message : String(err)
		});
	});

	return new Response(JSON.stringify({ runId: run.runId, boardId: jobBoardId }), {
		status: 202,
		headers: { 'content-type': 'application/json' }
	});
};

// ── GET: SSE stream via EventSource ─────────────────────────────────

export const GET: RequestHandler = ({ params, request }) => {
	const jobBoardId = Number(params.id);

	if (Number.isNaN(jobBoardId)) {
		return new Response(JSON.stringify({ error: 'Invalid job board ID' }), {
			status: 400,
			headers: { 'content-type': 'application/json' }
		});
	}

	// Parse Last-Event-ID for replay support
	const lastEventIdHeader = request.headers.get('Last-Event-ID');
	const lastEventId = lastEventIdHeader ? Number(lastEventIdHeader) || 0 : 0;

	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		start(controller) {
			let closed = false;
			let pingTimer: ReturnType<typeof setInterval> | null = null;

			function send(text: string) {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(text));
				} catch {
					cleanup();
				}
			}

			function cleanup() {
				if (closed) return;
				closed = true;
				if (pingTimer) {
					clearInterval(pingTimer);
					pingTimer = null;
				}
				unsubscribe();
				try {
					controller.close();
				} catch {
					// already closed
				}
			}

			// Subscribe to live events
			const { replay, unsubscribe, run } = scrapeRunManager.subscribe(
				jobBoardId,
				(eventId, eventType, event) => {
					send(formatSseFrame(eventId, eventType, event));

					// Close the stream after terminal events
					if (eventType === 'scrape-finish' || eventType === 'scrape-error') {
						// Small delay to ensure the frame is flushed before close
						setTimeout(() => cleanup(), 50);
					}
				},
				lastEventId
			);

			// If there's no run at all, send an info comment and close
			if (!run) {
				send(formatSseComment('no active run'));
				// Send an error event so the client knows there's nothing to stream
				const noRunEvent: AgentStepEvent = {
					type: 'scrape-error',
					timestamp: Date.now(),
					message: 'No active scrape run for this board',
					data: {
						kind: 'scrape-error',
						error: 'No active scrape run for this board. Trigger a scrape first.',
						durationMs: 0
					} satisfies ScrapeErrorPayload
				};
				send(formatSseFrame(0, 'scrape-error', noRunEvent));
				cleanup();
				return;
			}

			// Replay buffered events the client missed
			for (const { eventId, eventType, event } of replay) {
				send(formatSseFrame(eventId, eventType, event));
			}

			// If the run is already in a terminal state and we've replayed
			// everything, close after a short flush delay
			if (run.state === 'done' || run.state === 'error') {
				setTimeout(() => cleanup(), 50);
				return;
			}

			// Keep-alive ping every 15 seconds
			pingTimer = setInterval(() => {
				send(formatSseComment('ping'));
			}, 15_000);

			// Handle client disconnect
			request.signal.addEventListener('abort', () => {
				cleanup();
			});
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-store, must-revalidate',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
};

// ── Background scrape execution ─────────────────────────────────────

interface ScrapeParams {
	jobBoardId: number;
	jobBoard: { id: number; name: string; base_url: string };
	targetUrl: string;
	agentId: string;
	detectedBoard: string;
	profileJson: string;
	paginationContext: PaginationContext;
}

async function executeScrape(params: ScrapeParams): Promise<void> {
	const {
		jobBoardId,
		jobBoard,
		targetUrl,
		agentId,
		detectedBoard,
		profileJson,
		paginationContext
	} = params;

	const startTime = Date.now();

	function push(event: AgentStepEvent) {
		scrapeRunManager.pushEvent(jobBoardId, event.type, event);
	}

	// Start audit log timer
	const finishAudit = services.auditLogService.start({
		category: 'scrape',
		agent_id: agentId,
		title: `Scraping ${jobBoard.name} (${detectedBoard})`,
		detail: `Target URL: ${targetUrl}`,
		meta: {
			jobBoardId,
			jobBoardName: jobBoard.name,
			targetUrl,
			detectedBoard,
			agentId
		}
	});

	// Emit scrape-start
	push(
		createStepEvent('scrape-start', `Starting scrape of ${jobBoard.name} via ${agentId}`, {
			kind: 'scrape-start',
			jobBoardId,
			jobBoardName: jobBoard.name,
			targetUrl,
			agentId,
			detectedBoard
		} satisfies ScrapeStartPayload)
	);

	try {
		// Build request context
		const requestContext = new RequestContext<JobBoardRequestContext>();
		requestContext.set('job-board-url', targetUrl);
		requestContext.set('user-profile', profileJson);
		requestContext.set('pagination-context', JSON.stringify(paginationContext));

		const agent = mastra.getAgent(agentId as Parameters<typeof mastra.getAgent>[0]);

		logger.info('[scrape-stream] starting streamed scrape', {
			jobBoardId,
			targetUrl,
			agentId,
			detectedBoard
		});

		const result = await agent.stream(
			`Scrape the job board at the configured URL and extract all visible job listings. ` +
				`For each listing, extract the job title, company name, location, job type (remote/hybrid/on-site), ` +
				`salary range, and any visible description or responsibilities. ` +
				`Do NOT attempt to apply for any jobs or interact with application forms. ` +
				`You MUST include current_page, current_page_url, and has_more_pages in your JSON response. ` +
				`Return your final answer as a single JSON object (no surrounding text).`,
			{
				requestContext,
				maxSteps: 30
			}
		);

		let stepIndex = 0;
		let accumulatedText = '';

		const reader = result.fullStream.getReader();

		try {
			while (true) {
				const { done, value: chunk } = await reader.read();
				if (done) break;

				switch (chunk.type) {
					case 'step-start': {
						push(
							createStepEvent('step-start', `Step ${stepIndex + 1} started`, {
								kind: 'step-start',
								stepIndex
							} satisfies StepStartPayload)
						);
						break;
					}

					case 'tool-call': {
						const tc = chunk.payload as {
							toolCallId: string;
							toolName: string;
							args?: Record<string, unknown>;
						};
						const label = getToolLabel(tc.toolName);
						const argsPreview = tc.args ? truncate(JSON.stringify(tc.args), 300) : '';
						push(
							createStepEvent(
								'tool-call',
								`Calling ${label}${argsPreview ? `: ${argsPreview}` : ''}`,
								{
									kind: 'tool-call',
									toolCallId: tc.toolCallId,
									toolName: tc.toolName,
									args: tc.args
								} satisfies ToolCallPayload
							)
						);
						break;
					}

					case 'tool-result': {
						const tr = chunk.payload as {
							toolCallId: string;
							toolName: string;
							result: unknown;
							isError?: boolean;
						};
						const label = getToolLabel(tr.toolName);
						const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result);
						push(
							createStepEvent('tool-result', `${label} → ${truncate(resultStr, 200)}`, {
								kind: 'tool-result',
								toolCallId: tr.toolCallId,
								toolName: tr.toolName,
								result: truncate(resultStr, 1000),
								isError: tr.isError
							} satisfies ToolResultPayload)
						);
						break;
					}

					case 'tool-error': {
						const te = chunk.payload as {
							toolCallId: string;
							toolName: string;
							error: unknown;
						};
						const label = getToolLabel(te.toolName);
						const errorMsg = te.error instanceof Error ? te.error.message : String(te.error);
						push(
							createStepEvent('tool-error', `${label} failed: ${truncate(errorMsg, 200)}`, {
								kind: 'tool-error',
								toolCallId: te.toolCallId,
								toolName: te.toolName,
								error: errorMsg
							} satisfies ToolErrorPayload)
						);
						break;
					}

					case 'text-delta': {
						const td = chunk.payload as { text: string };
						accumulatedText += td.text;
						if (td.text.trim().length > 0) {
							push(
								createStepEvent('text-delta', td.text, {
									kind: 'text-delta',
									text: td.text
								} satisfies TextDeltaPayload)
							);
						}
						break;
					}

					case 'step-finish': {
						const sf = chunk.payload as {
							stepResult?: {
								reason?: string;
							};
							output?: {
								toolCalls?: unknown[];
								usage?: {
									inputTokens?: number;
									outputTokens?: number;
									totalTokens?: number;
								};
							};
						};
						push(
							createStepEvent(
								'step-finish',
								`Step ${stepIndex + 1} finished (${sf.stepResult?.reason ?? 'unknown'})`,
								{
									kind: 'step-finish',
									stepIndex,
									finishReason: sf.stepResult?.reason,
									toolCallCount: sf.output?.toolCalls?.length,
									usage: sf.output?.usage
								} satisfies StepFinishPayload
							)
						);
						stepIndex++;
						break;
					}

					default:
						break;
				}
			}
		} finally {
			reader.releaseLock();
		}

		// ── Post-stream: parse result, persist jobs, emit finish ─────

		const errors: string[] = [];
		const agentText = accumulatedText || (await result.text);
		const scrapeResult = parseAgentResponse(agentText);

		if (!scrapeResult) {
			errors.push('Agent response could not be parsed as valid JSON');
			logger.warn('[scrape-stream] no parseable JSON in agent response', {
				textLength: agentText.length
			});

			finishAudit({
				status: 'error',
				detail: `Agent response could not be parsed`,
				meta: { jobBoardId, targetUrl }
			});

			push(
				createStepEvent('scrape-error', 'Agent did not return valid structured output', {
					kind: 'scrape-error',
					error: 'Agent response could not be parsed as valid JSON',
					durationMs: Date.now() - startTime
				} satisfies ScrapeErrorPayload)
			);
			return;
		}

		if (scrapeResult.errors.length > 0) {
			errors.push(...scrapeResult.errors);
		}

		if (scrapeResult.blocked) {
			finishAudit({
				status: 'warning',
				detail: `Blocked by ${detectedBoard} — login or CAPTCHA required`,
				meta: {
					jobBoardId,
					targetUrl,
					blocked: true,
					agentErrors: scrapeResult.errors
				}
			});

			push(
				createStepEvent(
					'scrape-finish',
					`Blocked by ${detectedBoard} — login or CAPTCHA required`,
					{
						kind: 'scrape-finish',
						success: false,
						totalFound: 0,
						newApplications: 0,
						duplicatesSkipped: 0,
						errors,
						blocked: true,
						durationMs: Date.now() - startTime
					} satisfies ScrapeFinishPayload
				)
			);
			return;
		}

		// Persist jobs
		let newApplications = 0;
		let duplicatesSkipped = 0;
		const jobBoardService = services.jobBoardService;

		for (const job of scrapeResult.jobs) {
			try {
				const { isNew } = await jobBoardService.addApplicationFromJob({
					job_board_id: jobBoardId,
					title: job.title,
					company: job.company,
					location: job.location,
					job_type: job.job_type ?? 'unknown',
					salary_range: job.salary_range,
					description: job.description,
					job_description_url: job.url,
					posted_at: job.posted_at ?? new Date().toISOString(),
					created_at: new Date().toISOString()
				});
				if (isNew) {
					newApplications++;
				} else {
					duplicatesSkipped++;
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				errors.push(`Failed to persist "${job.title}": ${msg}`);
			}
		}

		// Update last checked
		try {
			await jobBoardService.updateLastChecked(jobBoardId, new Date().toISOString());
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			errors.push(`Failed to update lastRunAt: ${msg}`);
		}

		// Update pagination bookmark for next session
		try {
			await advancePagination(jobBoardId, scrapeResult);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			errors.push(`Failed to update pagination state: ${msg}`);
		}

		const overallSuccess = scrapeResult.success && errors.length === 0;
		const durationMs = Date.now() - startTime;

		finishAudit({
			status: overallSuccess ? 'success' : 'warning',
			detail: overallSuccess
				? `Found ${scrapeResult.total_found} jobs — ${newApplications} new, ${duplicatesSkipped} duplicates`
				: `Completed with issues: ${errors.join('; ')}`,
			meta: {
				jobBoardId,
				targetUrl,
				totalFound: scrapeResult.total_found,
				newApplications,
				duplicatesSkipped,
				currentPage: scrapeResult.current_page,
				currentPageUrl: scrapeResult.current_page_url,
				hasMorePages: scrapeResult.has_more_pages,
				errors: errors.length > 0 ? errors : undefined
			}
		});

		push(
			createStepEvent(
				'scrape-finish',
				overallSuccess
					? `Done — ${scrapeResult.total_found} jobs found, ${newApplications} new`
					: `Finished with issues: ${errors.join('; ')}`,
				{
					kind: 'scrape-finish',
					success: overallSuccess,
					totalFound: scrapeResult.total_found,
					newApplications,
					duplicatesSkipped,
					errors,
					blocked: false,
					currentPage: scrapeResult.current_page,
					currentPageUrl: scrapeResult.current_page_url,
					hasMorePages: scrapeResult.has_more_pages,
					durationMs
				} satisfies ScrapeFinishPayload
			)
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error('[scrape-stream] execution failed', {
			jobBoardId,
			error: message
		});

		finishAudit({
			status: 'error',
			detail: `Agent execution failed: ${message}`,
			meta: { jobBoardId, targetUrl, error: message }
		});

		push(
			createStepEvent('scrape-error', `Scrape failed: ${message}`, {
				kind: 'scrape-error',
				error: message,
				durationMs: Date.now() - startTime
			} satisfies ScrapeErrorPayload)
		);
	}
}

// ── Pagination advancement helper ───────────────────────────────────

/**
 * Advances (or resets) the pagination bookmark based on the agent's report.
 *
 * - `has_more_pages === true` → Save `current_page + 1` so the next session
 *   starts on the page *after* the one already scraped.
 * - `has_more_pages === false` → Clear the bookmark so the next session
 *   starts from the beginning (the board has been fully traversed).
 * - If the agent omitted pagination fields, leave the bookmark untouched.
 */
async function advancePagination(jobBoardId: number, result: ScrapeResult): Promise<void> {
	const { current_page, current_page_url, has_more_pages } = result;
	const jobBoardService = services.jobBoardService;

	if (current_page == null || current_page_url == null) {
		logger.warn('[scrape-stream] agent omitted pagination fields — bookmark unchanged', {
			jobBoardId,
			current_page,
			current_page_url,
			has_more_pages
		});
		return;
	}

	if (has_more_pages) {
		const nextPage = current_page + 1;
		const nextPageUrl = buildNextPageUrl(current_page_url, nextPage) ?? current_page_url;

		logger.info('[scrape-stream] advancing pagination bookmark', {
			jobBoardId,
			scrapedPage: current_page,
			nextPage,
			nextPageUrl
		});

		await jobBoardService.updatePaginationState(jobBoardId, nextPage, nextPageUrl);
	} else {
		logger.info('[scrape-stream] resetting pagination — no more pages', {
			jobBoardId,
			scrapedPage: current_page
		});

		await jobBoardService.resetPaginationState(jobBoardId);
	}
}

/**
 * Attempts to compute the URL for the next page by detecting and incrementing
 * common pagination query parameters in the current page URL.
 *
 * Supports: `start` (LinkedIn offset), `page`, `p`, `offset`.
 * Returns `null` if no known parameter was detected.
 */
function buildNextPageUrl(currentUrl: string, nextPage: number): string | null {
	try {
		const url = new URL(currentUrl);
		const params = url.searchParams;

		// LinkedIn: `start` is an offset (items-per-page * (page - 1))
		if (params.has('start')) {
			const currentStart = Number(params.get('start'));
			if (!Number.isNaN(currentStart)) {
				const currentPage = nextPage - 1;
				const pageSize = currentPage > 1 ? Math.round(currentStart / (currentPage - 1)) : 25;
				params.set('start', String(pageSize * (nextPage - 1)));
				return url.toString();
			}
		}

		// Generic: `page` or `p` (1-based)
		if (params.has('page')) {
			params.set('page', String(nextPage));
			return url.toString();
		}
		if (params.has('p')) {
			params.set('p', String(nextPage));
			return url.toString();
		}

		// Generic: `offset`
		if (params.has('offset')) {
			const currentOffset = Number(params.get('offset'));
			if (!Number.isNaN(currentOffset)) {
				const currentPage = nextPage - 1;
				const stride = currentPage > 1 ? Math.round(currentOffset / (currentPage - 1)) : 25;
				params.set('offset', String(stride * (nextPage - 1)));
				return url.toString();
			}
		}

		return null;
	} catch {
		return null;
	}
}
