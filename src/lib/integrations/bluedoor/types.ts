/** Minimal bluedoor Job Postings API shapes used by HuntOS integration. */

export interface BluedoorJob {
	job_id: string;
	org_id?: string | null;
	title: string;
	location_text?: string | null;
	city?: string | null;
	country?: string | null;
	region?: string | null;
	workplace_type?: string | null;
	salary_raw?: string | null;
	description_text?: string | null;
	source_url?: string | null;
	apply_url?: string | null;
	source_posted_at?: string | null;
	event_fields?: {
		last_changed_at?: string | null;
	};
}

export interface BluedoorOrg {
	org_id: string;
	display_name?: string | null;
}

export interface BluedoorSearchResponse {
	data: BluedoorJob[];
	meta?: {
		limit?: number;
		next_cursor?: string | null;
		total_matching?: number;
	};
}

export interface BluedoorOrgResponse {
	data: BluedoorOrg;
}
