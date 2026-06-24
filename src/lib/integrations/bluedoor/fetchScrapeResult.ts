import type { ScrapeResult } from '$lib/mastra/agents/job-board-agent/types';
import { companyNameFromUrl, mapBluedoorJob } from './mapJob';
import {
	buildNextSearchUrl,
	fetchOrgName,
	getApiBaseFromSearchUrl,
	resolveSearchUrl,
	searchJobs
} from './client';

export interface FetchBluedoorOptions {
	boardBaseUrl: string;
	resumePageUrl?: string | null;
	maxListings: number;
}

/**
 * Fetches one page of jobs from the bluedoor search URL configured on a job board.
 */
export async function fetchBluedoorScrapeResult(
	options: FetchBluedoorOptions
): Promise<{ result: ScrapeResult; nextSearchUrl: string | null }> {
	const requestUrl = resolveSearchUrl(options.boardBaseUrl, {
		resumePageUrl: options.resumePageUrl,
		maxListings: options.maxListings
	});

	const payload = await searchJobs(requestUrl);
	const apiBase = getApiBaseFromSearchUrl(requestUrl);
	const orgCache = new Map<string, string>();
	const jobs = [];

	for (const item of payload.data ?? []) {
		let company = '';
		if (item.org_id) {
			if (orgCache.has(item.org_id)) {
				company = orgCache.get(item.org_id) ?? '';
			} else {
				try {
					company = await fetchOrgName(apiBase, item.org_id);
				} catch {
					company = '';
				}
				orgCache.set(item.org_id, company);
			}
		}

		if (!company) {
			const fallbackUrl = item.apply_url ?? item.source_url ?? '';
			company = fallbackUrl ? companyNameFromUrl(fallbackUrl) : 'Unknown company';
		}

		const mapped = mapBluedoorJob(item, company);
		if (mapped) jobs.push(mapped);
	}

	const nextCursor = payload.meta?.next_cursor?.trim();
	const nextSearchUrl = nextCursor ? buildNextSearchUrl(requestUrl, nextCursor) : null;

	const result: ScrapeResult = {
		success: true,
		source_url: requestUrl,
		scraped_at: new Date().toISOString(),
		total_found: jobs.length,
		jobs,
		errors: [],
		blocked: false,
		current_page: 1,
		current_page_url: requestUrl,
		has_more_pages: Boolean(nextCursor)
	};

	return { result, nextSearchUrl };
}
