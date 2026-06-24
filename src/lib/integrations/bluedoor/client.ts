import { getBluedoorApiKey, getBluedoorUserAgent } from './config';
import type { BluedoorOrgResponse, BluedoorSearchResponse } from './types';

export class BluedoorApiError extends Error {
	status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = 'BluedoorApiError';
		this.status = status;
	}
}

async function bluedoorFetch<T>(url: string): Promise<T> {
	const headers: Record<string, string> = {
		Accept: 'application/json',
		'User-Agent': getBluedoorUserAgent()
	};

	const apiKey = getBluedoorApiKey();
	if (apiKey) {
		headers.Authorization = `Bearer ${apiKey}`;
	}

	const response = await fetch(url, { headers });
	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new BluedoorApiError(
			`bluedoor API ${response.status}: ${body.slice(0, 200) || response.statusText}`,
			response.status
		);
	}

	return (await response.json()) as T;
}

export async function searchJobs(searchUrl: string): Promise<BluedoorSearchResponse> {
	return bluedoorFetch<BluedoorSearchResponse>(searchUrl);
}

export async function fetchOrgName(apiBase: string, orgId: string): Promise<string> {
	const url = `${apiBase.replace(/\/+$/, '')}/orgs/${encodeURIComponent(orgId)}`;
	const payload = await bluedoorFetch<BluedoorOrgResponse>(url);
	return payload.data?.display_name?.trim() ?? '';
}

export function resolveSearchUrl(
	boardBaseUrl: string,
	options: { resumePageUrl?: string | null; maxListings: number }
): string {
	const raw = options.resumePageUrl ?? boardBaseUrl;
	const url = new URL(raw);

	if (!url.searchParams.has('limit')) {
		url.searchParams.set('limit', String(options.maxListings));
	} else {
		const limit = Number(url.searchParams.get('limit'));
		if (!Number.isFinite(limit) || limit > options.maxListings) {
			url.searchParams.set('limit', String(options.maxListings));
		}
	}

	return url.toString();
}

export function buildNextSearchUrl(currentUrl: string, nextCursor: string): string {
	const url = new URL(currentUrl);
	url.searchParams.set('cursor', nextCursor);
	return url.toString();
}

export function getApiBaseFromSearchUrl(searchUrl: string): string {
	const url = new URL(searchUrl);
	const match = url.pathname.match(/^(.*\/job-postings\/v\d+)/i);
	if (match?.[1]) return `${url.origin}${match[1]}`;
	return 'https://api.bluedoor.sh/job-postings/v1';
}
