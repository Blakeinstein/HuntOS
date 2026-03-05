// src/lib/mastra/tools/resume/scrape-and-embed-link.ts
// Resume agent tool that scrapes a profile link, generates an AI summary,
// and ensures the resulting embedding is indexed in link_summary_vec.
//
// Behaviour:
//   1. If the link already has a 'done' summary AND a vector embedding, return
//      the cached summary immediately — no scraping needed.
//   2. If the link exists but has no vector (e.g. dimension migration wiped it),
//      re-embed the existing summary without re-scraping.
//   3. Otherwise, enqueue a scrape job via LinkSummaryQueue and poll until the
//      job reaches a terminal state ('done' | 'error' | 'needs_login').
//   4. On success the queue already calls upsertEmbedding, so the vector is
//      ready by the time this tool returns.

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { LinkSummaryService } from '$lib/services/services/linkSummary';
import type { LinkSummaryVectorService } from '$lib/services/services/linkSummaryVector';
import type { LinkSummaryQueue } from '$lib/services/services/linkSummaryQueue';
import type { AuditLogService } from '$lib/services/services/auditLog';

// ── Constants ─────────────────────────────────────────────────────────────────

/** How often to check whether the queue job has finished (ms). */
const POLL_INTERVAL_MS = 1_500;

/** Maximum total time to wait for a scrape job before giving up (ms). */
const POLL_TIMEOUT_MS = 120_000;

// ── Factory ───────────────────────────────────────────────────────────────────

export interface ScrapeAndEmbedLinkDeps {
	linkSummaryService: LinkSummaryService;
	linkSummaryVectorService: LinkSummaryVectorService;
	linkSummaryQueue: LinkSummaryQueue;
	auditLogService: AuditLogService;
}

export function createScrapeAndEmbedLinkTool(deps: ScrapeAndEmbedLinkDeps) {
	const { linkSummaryService, linkSummaryVectorService, linkSummaryQueue, auditLogService } = deps;

	return createTool({
		id: 'scrape-and-embed-link',
		description:
			'Scrape a profile URL (GitHub, LinkedIn, portfolio, or any public page), generate an ' +
			'AI summary of its contents, and index the result as a vector embedding so it can be ' +
			'searched semantically.\n\n' +
			'Use this tool when:\n' +
			'- The user provides a URL you want to learn more about before writing the resume\n' +
			'- A link summary is missing or stale and you need fresh content\n' +
			'- You want to ensure a specific link is indexed before calling search-link-summaries\n\n' +
			'The tool is idempotent: if the link already has a current summary and embedding it ' +
			'returns the cached result immediately without re-scraping.\n\n' +
			'Returns the full AI-generated summary text on success.',

		inputSchema: z.object({
			title: z
				.string()
				.min(1)
				.describe(
					'Human-readable label for the link (e.g. "GitHub", "Portfolio", "LinkedIn"). ' +
						'Used as the unique key — passing the same title twice updates the existing record.'
				),
			url: z.string().url().describe('The URL to scrape and summarise.'),
			force: z
				.boolean()
				.optional()
				.describe(
					'If true, re-scrape even when a cached summary already exists. ' +
						'Defaults to false.'
				)
		}),

		outputSchema: z.object({
			success: z.boolean(),
			cached: z.boolean().describe('True if the result was returned from cache without scraping.'),
			summary: z.string().describe('The full AI-generated summary text, or empty on error.'),
			summaryType: z.string().describe('Category: github | linkedin | portfolio | generic.'),
			message: z.string().describe('Human-readable status message.')
		}),

		execute: async ({ title, url, force }) => {
			const finishAudit = auditLogService.start({
				category: 'resume',
				agent_id: 'resume-agent',
				title: `Scrape & embed: "${title}"`,
				detail: `URL: ${url}`,
				meta: { title, url, force: force ?? false }
			});

			try {
				// ── 1. Check cache ──────────────────────────────────────────────
				if (!force) {
					const existing = linkSummaryService.getByTitle(title);

					if (existing?.status === 'done' && existing.summary.trim().length > 0) {
						const indexedCount = linkSummaryVectorService.getIndexedCount();
						// Check whether this specific record has a vector by doing a quick search
						const hasVector = await checkHasVector(
							linkSummaryVectorService,
							existing.id,
							existing.summary
						);

						if (hasVector) {
							finishAudit({
								status: 'success',
								detail: `Returned cached summary for "${title}" (already embedded)`,
								meta: { title, cached: true, indexedCount }
							});

							return {
								success: true,
								cached: true,
								summary: existing.summary,
								summaryType: existing.summary_type,
								message: `Returned cached summary for "${title}". Already indexed in vector store.`
							};
						}

						// Summary exists but vector is missing — re-embed without re-scraping.
						await linkSummaryVectorService.upsertEmbedding(existing.id, existing.summary);

						finishAudit({
							status: 'success',
							detail: `Re-embedded existing summary for "${title}" (vector was missing)`,
							meta: { title, cached: true, reEmbedded: true }
						});

						return {
							success: true,
							cached: true,
							summary: existing.summary,
							summaryType: existing.summary_type,
							message:
								`Existing summary for "${title}" was re-indexed into the vector store ` +
								`(the embedding had been lost, likely after a dimension migration).`
						};
					}
				}

				// ── 2. Enqueue scrape job ───────────────────────────────────────
				// enqueue() is idempotent for already-running jobs.
				linkSummaryQueue.enqueue({ title, url });

				// ── 3. Poll for completion ──────────────────────────────────────
				const result = await pollForCompletion(title, linkSummaryService);

				if (result.status === 'error') {
					finishAudit({
						status: 'error',
						detail: `Scrape failed for "${title}": ${result.error ?? 'unknown error'}`,
						meta: { title, url, error: result.error }
					});

					return {
						success: false,
						cached: false,
						summary: '',
						summaryType: 'generic',
						message: `Scraping "${title}" failed: ${result.error ?? 'unknown error'}`
					};
				}

				if (result.status === 'needs_login') {
					finishAudit({
						status: 'warning',
						detail: `Login required to scrape "${title}"`,
						meta: { title, url, needsLogin: true }
					});

					return {
						success: false,
						cached: false,
						summary: '',
						summaryType: 'generic',
						message:
							`"${title}" requires the user to be logged in. ` +
							`${result.error ?? 'Please log in via the browser and retry.'}`
					};
				}

				if (result.status === 'timeout') {
					finishAudit({
						status: 'error',
						detail: `Timed out waiting for scrape of "${title}" after ${POLL_TIMEOUT_MS / 1000}s`,
						meta: { title, url }
					});

					return {
						success: false,
						cached: false,
						summary: '',
						summaryType: 'generic',
						message:
							`Timed out waiting for "${title}" to finish scraping ` +
							`(>${POLL_TIMEOUT_MS / 1000}s). The job may still be running in the background.`
					};
				}

				// status === 'done'
				const record = linkSummaryService.getByTitle(title);
				const summary = record?.summary ?? '';
				const summaryType = record?.summary_type ?? 'generic';

				finishAudit({
					status: 'success',
					detail: `Scraped and embedded "${title}" successfully`,
					meta: { title, url, summaryLength: summary.length }
				});

				return {
					success: true,
					cached: false,
					summary,
					summaryType,
					message:
						`Successfully scraped and embedded "${title}". ` +
						`Summary is ${summary.length} characters and is now searchable via search-link-summaries.`
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);

				finishAudit({
					status: 'error',
					detail: `Unexpected error in scrape-and-embed for "${title}": ${message}`,
					meta: { title, url, error: message }
				});

				return {
					success: false,
					cached: false,
					summary: '',
					summaryType: 'generic',
					message: `Unexpected error while scraping "${title}": ${message}`
				};
			}
		}
	});
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type PollResult =
	| { status: 'done' }
	| { status: 'error'; error: string | null }
	| { status: 'needs_login'; error: string | null }
	| { status: 'timeout' };

/**
 * Poll `linkSummaryService.getByTitle()` until the record reaches a terminal
 * state or the timeout elapses.
 */
async function pollForCompletion(
	title: string,
	linkSummaryService: LinkSummaryService
): Promise<PollResult> {
	const deadline = Date.now() + POLL_TIMEOUT_MS;

	while (Date.now() < deadline) {
		await sleep(POLL_INTERVAL_MS);

		const record = linkSummaryService.getByTitle(title);
		if (!record) continue;

		switch (record.status) {
			case 'done':
				return { status: 'done' };
			case 'error':
				return { status: 'error', error: record.error_message };
			case 'needs_login':
				return { status: 'needs_login', error: record.error_message };
			// 'pending' | 'running' — keep polling
		}
	}

	return { status: 'timeout' };
}

/**
 * Heuristic check for whether a given link summary already has a vector.
 * We do a narrow semantic search using the first 200 chars of the summary
 * and check if the top result matches the expected id.
 */
async function checkHasVector(
	vectorService: LinkSummaryVectorService,
	linkSummaryId: number,
	summary: string
): Promise<boolean> {
	try {
		const probe = summary.slice(0, 200).trim();
		if (!probe) return false;
		const results = await vectorService.search(probe, 1);
		return results.some((r) => r.linkSummaryId === linkSummaryId);
	} catch {
		// If search fails (e.g. empty vector table) assume no vector exists.
		return false;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
