import type { ScrapedJob } from '$lib/mastra/agents/job-board-agent/types';
import type { BluedoorJob } from './types';

function mapWorkplaceType(value: string | null | undefined): ScrapedJob['job_type'] {
	switch ((value ?? '').toLowerCase()) {
		case 'remote':
			return 'remote';
		case 'hybrid':
			return 'hybrid';
		case 'on_site':
		case 'onsite':
		case 'on-site':
			return 'on-site';
		default:
			return 'unknown';
	}
}

function formatLocation(job: BluedoorJob): string | null {
	if (job.location_text?.trim()) return job.location_text.trim();
	const parts = [job.city, job.region, job.country].filter(Boolean);
	return parts.length ? parts.join(', ') : null;
}

function formatSalary(job: BluedoorJob): string | null {
	return job.salary_raw?.trim() || null;
}

function jobUrl(job: BluedoorJob): string | null {
	const url = job.apply_url?.trim() || job.source_url?.trim();
	return url || null;
}

export function mapBluedoorJob(job: BluedoorJob, companyName: string): ScrapedJob | null {
	const url = jobUrl(job);
	if (!url) return null;

	return {
		title: job.title?.trim() || 'Untitled role',
		company: companyName || 'Unknown company',
		location: formatLocation(job),
		url,
		job_type: mapWorkplaceType(job.workplace_type),
		salary_range: formatSalary(job),
		description: job.description_text?.trim() || null,
		posted_at: job.source_posted_at ?? job.event_fields?.last_changed_at ?? null
	};
}

export function companyNameFromUrl(url: string): string {
	try {
		const host = new URL(url).hostname.replace(/^www\./, '');
		const label = host.split('.')[0] ?? host;
		return label.charAt(0).toUpperCase() + label.slice(1);
	} catch {
		return 'Unknown company';
	}
}
