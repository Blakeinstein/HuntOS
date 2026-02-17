// src/routes/api/job-boards/[id]/scrape-stream/+server.ts
// SSE endpoint that streams agent execution steps during a scrape in real time.
//
// Usage: POST /api/job-boards/:id/scrape-stream
// Returns: text/event-stream with AgentStepEvent JSON payloads
//
// The endpoint kicks off a scrape using `agent.stream()` instead of
// `agent.generate()`, reads the `fullStream`, and re-emits relevant
// chunks as SSE `data:` lines the client can consume via EventSource
// or a fetch + ReadableStream reader.

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

// ── SSE helpers ─────────────────────────────────────────────────────

function sseEncode(event: AgentStepEvent): string {
	return `data: ${JSON.stringify(event)}\n\n`;
}

// ── Handler ─────────────────────────────────────────────────────────

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

	// --- load job board + profile up front so we can fail fast ---
	const jobBoard = await services.jobBoardService.getJobBoard(jobBoardId);
	if (!jobBoard) {
		return new Response(JSON.stringify({ error: 'Job board not found' }), {
			status: 404,
			headers: { 'content-type': 'application/json' }
		});
	}

	// Resolve pagination state (handles retention expiry automatically)
	const paginationState: PaginationState =
		await services.jobBoardService.resolvePaginationState(jobBoardId);

	const paginationContext: PaginationContext = {
		resume_page: paginationState.resumePage,
		resume_page_url: paginationState.resumePageUrl,
		max_listings: paginationState.maxListings
	};

	const targetUrl = paginationState.resumePageUrl ?? jobBoard.base_url;
	const entry = subAgentRegistry.resolve(targetUrl);
	const agentId = entry?.agentId ?? 'job-board-agent.generic';
	const detectedBoard = entry?.board ?? 'generic';

	const profile = await services.profileService.getProfile();
	const profileJson = JSON.stringify(profile, null, 2);

	// ── Build the SSE ReadableStream ────────────────────────────────
	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();

			function emit(event: AgentStepEvent) {
				try {
					controller.enqueue(encoder.encode(sseEncode(event)));
				} catch {
					// stream may have been closed by client
				}
			}

			const startTime = Date.now();

			// Start the audit log timer
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
			emit(
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

				// Use agent.stream() to get a streamable result
				const result = await agent.stream(
					`Scrape the job board at the configured URL and extract all visible job listings. ` +
						`Evaluate each listing against the user profile for relevance. ` +
						`Return your final answer as a single JSON object (no surrounding text).`,
					{
						requestContext,
						maxSteps: 30
					}
				);

				// Track state for step indexing
				let stepIndex = 0;
				let accumulatedText = '';

				// Read the fullStream and emit events
				const reader = result.fullStream.getReader();

				try {
					while (true) {
						const { done, value: chunk } = await reader.read();
						if (done) break;

						switch (chunk.type) {
							case 'step-start': {
								emit(
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
								emit(
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
								const resultStr =
									typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result);
								emit(
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
								emit(
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
								// Only emit text deltas for non-trivial chunks to avoid flooding
								if (td.text.trim().length > 0) {
									emit(
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
								emit(
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

							// Skip other chunk types — they're not useful for the UI
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

					emit(
						createStepEvent('scrape-error', 'Agent did not return valid structured output', {
							kind: 'scrape-error',
							error: 'Agent response could not be parsed as valid JSON',
							durationMs: Date.now() - startTime
						} satisfies ScrapeErrorPayload)
					);

					controller.close();
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

					emit(
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

					controller.close();
					return;
				}

				// Persist jobs
				let newApplications = 0;
				let duplicatesSkipped = 0;
				const jobBoardService = services.jobBoardService;

				for (const job of scrapeResult.jobs) {
					try {
						const appId = await jobBoardService.addApplicationFromJob({
							job_board_id: jobBoardId,
							title: job.title,
							company: job.company,
							location: job.location,
							salary_range: job.salary_range,
							job_description_url: job.url,
							posted_at: job.posted_at ?? new Date().toISOString(),
							created_at: new Date().toISOString()
						});
						if (appId > 0) newApplications++;
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						errors.push(`Failed to persist "${job.title}": ${msg}`);
						duplicatesSkipped++;
					}
				}

				// Update last checked
				try {
					await jobBoardService.updateLastChecked(jobBoardId, new Date().toISOString());
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					errors.push(`Failed to update lastRunAt: ${msg}`);
				}

				// Update pagination bookmark so the next scrape resumes from here
				try {
					if (scrapeResult.current_page && scrapeResult.current_page_url) {
						await jobBoardService.updatePaginationState(
							jobBoardId,
							scrapeResult.current_page,
							scrapeResult.current_page_url
						);
					} else if (scrapeResult.current_page) {
						await jobBoardService.updatePaginationState(
							jobBoardId,
							scrapeResult.current_page,
							targetUrl
						);
					}
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
						errors: errors.length > 0 ? errors : undefined
					}
				});

				emit(
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

				emit(
					createStepEvent('scrape-error', `Scrape failed: ${message}`, {
						kind: 'scrape-error',
						error: message,
						durationMs: Date.now() - startTime
					} satisfies ScrapeErrorPayload)
				);
			}

			controller.close();
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
};
