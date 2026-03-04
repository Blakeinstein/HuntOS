import type { Database } from './database';

/** A single user-managed link with title, URL, and optional description. */
export interface ProfileLink {
	id: string;
	title: string;
	url: string;
	description: string;
}

/** Default links seeded for new profiles. */
const DEFAULT_PROFILE_LINKS: ProfileLink[] = [
	{
		id: 'linkedin',
		title: 'LinkedIn',
		url: '',
		description: 'My professional profile'
	}
];

export type ProfileKey =
	| 'name'
	| 'email'
	| 'phone'
	| 'location'
	| 'skills'
	| 'experience'
	| 'education'
	| 'certifications'
	| 'languages'
	| 'preferred_companies'
	| 'job_titles'
	| 'salary_expectations'
	| 'availability'
	| 'resume_summary'
	| 'portfolio_url'
	| 'linkedin_url'
	// Job search preferences
	| 'desired_location'
	| 'desired_job_type'
	| 'desired_work_arrangement'
	| 'job_search_criteria'
	| 'years_of_experience'
	// Work authorization & immigration
	| 'has_active_visa'
	| 'visa_type'
	| 'visa_expiry_date'
	| 'work_auth_valid_until'
	| 'needs_sponsorship'
	| 'open_to_relocate'
	| 'current_work_preference'
	| 'immigration_notes'
	// Additional application notes
	| 'application_notes'
	// Supplemental links (stored as JSON array)
	| 'github_url'
	| 'website_urls'
	// Dynamic links list (stored as JSON array of ProfileLink objects)
	| 'profile_links'
	// Projects
	| 'projects'
	// Comprehensive semi-structured description used by other agents
	| 'profile_description'
	// Raw content extracted from resume uploads
	| 'resume_raw_text'
	// Raw content scraped from external links
	| 'scraped_content';

const VALID_PROFILE_KEYS: ProfileKey[] = [
	'name',
	'email',
	'phone',
	'location',
	'skills',
	'experience',
	'education',
	'certifications',
	'languages',
	'preferred_companies',
	'job_titles',
	'salary_expectations',
	'availability',
	'resume_summary',
	'portfolio_url',
	'linkedin_url',
	'desired_location',
	'desired_job_type',
	'desired_work_arrangement',
	'job_search_criteria',
	'years_of_experience',
	// Work authorization & immigration
	'has_active_visa',
	'visa_type',
	'visa_expiry_date',
	'work_auth_valid_until',
	'needs_sponsorship',
	'open_to_relocate',
	'current_work_preference',
	'immigration_notes',
	// Additional application notes
	'application_notes',
	'github_url',
	'website_urls',
	'profile_links',
	'projects',
	'profile_description',
	'resume_raw_text',
	'scraped_content'
];

export interface ProfileData {
	[key: string]: string | string[];
}

export interface ProfileUpdate {
	key: ProfileKey;
	value: string | string[];
	source: 'manual' | 'llm' | 'job_match' | 'resume_parse' | 'scrape';
}

export class ProfileService {
	private db: Database;

	constructor(db: Database) {
		this.db = db;
	}

	/**
	 * Get profile data by key
	 */
	async getProfile(key?: ProfileKey): Promise<ProfileData> {
		if (key) {
			const profile = await this.db.get(`SELECT * FROM profiles WHERE key = ?`, [key]);
			return profile ? { [key]: this.parseValue(profile.value) } : {};
		}

		const profiles = await this.db.all(`SELECT * FROM profiles`);
		return profiles.reduce<ProfileData>((acc, p) => {
			acc[p.key as ProfileKey] = this.parseValue(p.value);
			return acc;
		}, {});
	}

	/**
	 * Update profile data
	 */
	async updateProfile(key: ProfileKey, value: string | string[]): Promise<void> {
		const serializedValue = Array.isArray(value) ? JSON.stringify(value) : value;

		await this.db.run(
			`
      INSERT INTO profiles (user_id, key, value, created_at, updated_at)
      VALUES (1, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(user_id, key) DO UPDATE SET
        value = excluded.value,
        updated_at = datetime('now')
    `,
			[key, serializedValue]
		);
	}

	/**
	 * Bulk update multiple profile keys at once.
	 * Returns the list of keys that were updated.
	 */
	async updateProfileBulk(updates: ProfileUpdate[]): Promise<ProfileKey[]> {
		const updated: ProfileKey[] = [];
		for (const { key, value } of updates) {
			if (!this.isValidProfileKey(key)) {
				console.warn(`Skipping invalid profile key: ${key}`);
				continue;
			}
			await this.updateProfile(key, value);
			updated.push(key);
		}
		return updated;
	}

	/**
	 * Append to an array-typed profile field rather than overwriting.
	 * If the field doesn't exist yet, it is created as a new array.
	 */
	async appendToProfile(key: ProfileKey, items: string[]): Promise<void> {
		const existing = await this.getProfile(key);
		const current = existing[key];
		let merged: string[];

		if (Array.isArray(current)) {
			const set = new Set([...current, ...items]);
			merged = [...set];
		} else if (typeof current === 'string' && current.length > 0) {
			// If existing value is a plain string, convert to array
			const set = new Set([current, ...items]);
			merged = [...set];
		} else {
			merged = items;
		}

		await this.updateProfile(key, merged);
	}

	/**
	 * Parse profile value from database
	 */
	private parseValue(value: string): string | string[] {
		try {
			return JSON.parse(value);
		} catch {
			return value;
		}
	}

	/**
	 * Analyze job description and extract relevant profile matches
	 */
	async analyzeJobDescription(jobDescription: string): Promise<ProfileMatchAnalysis> {
		const profile = await this.getProfile();

		console.log('Analyzing job description (placeholder):', jobDescription.substring(0, 100));

		return {
			profile,
			matches: [],
			missing: [],
			recommendations: []
		};
	}

	/**
	 * Suggest profile updates based on job requirements
	 */
	async suggestProfileUpdates(jobDescription: string): Promise<ProfileUpdateSuggestion[]> {
		console.log(
			'Suggesting profile updates for job description (placeholder):',
			jobDescription.substring(0, 100)
		);
		return [];
	}

	/**
	 * Get profile completeness score.
	 * Weights different categories to give a more meaningful score.
	 */
	async getCompletenessScore(): Promise<number> {
		const profile = await this.getProfile();

		const requiredFields: { key: ProfileKey; weight: number }[] = [
			{ key: 'name', weight: 1 },
			{ key: 'email', weight: 1 },
			{ key: 'phone', weight: 1 },
			{ key: 'skills', weight: 2 },
			{ key: 'experience', weight: 2 }
		];

		const bonusFields: { key: ProfileKey; weight: number }[] = [
			{ key: 'education', weight: 1 },
			{ key: 'desired_location', weight: 1 },
			{ key: 'desired_job_type', weight: 1 },
			{ key: 'job_titles', weight: 1 },
			{ key: 'resume_summary', weight: 1 },
			{ key: 'profile_description', weight: 2 },
			{ key: 'projects', weight: 1 },
			{ key: 'needs_sponsorship', weight: 1 },
			{ key: 'open_to_relocate', weight: 1 }
		];

		const allFields = [...requiredFields, ...bonusFields];
		let totalWeight = 0;
		let filledWeight = 0;

		for (const { key, weight } of allFields) {
			totalWeight += weight;
			const value = profile[key];
			if (value && (typeof value === 'string' ? value.length > 0 : value.length > 0)) {
				filledWeight += weight;
			}
		}

		return totalWeight > 0 ? Math.round((filledWeight / totalWeight) * 100) : 0;
	}

	/**
	 * Get incomplete profile fields
	 */
	async getIncompleteFields(): Promise<ProfileKey[]> {
		const requiredKeys: ProfileKey[] = [
			'name',
			'email',
			'phone',
			'skills',
			'experience',
			'desired_location',
			'desired_job_type',
			'job_titles',
			'needs_sponsorship',
			'open_to_relocate'
		];
		const profile = await this.getProfile();

		return requiredKeys.filter((key) => {
			const value = profile[key];
			return !value || (typeof value === 'string' ? value.length === 0 : value.length === 0);
		});
	}

	/**
	 * Get the comprehensive profile description for use by other agents.
	 * Returns null if not yet generated.
	 */
	async getProfileDescription(): Promise<string | null> {
		const profile = await this.getProfile('profile_description');
		const desc = profile['profile_description'];
		if (!desc) return null;
		return typeof desc === 'string' ? desc : desc.join('\n');
	}

	// ── Profile Links helpers ─────────────────────────────────────────

	/**
	 * Get the user's links list. Seeds defaults if none exist yet.
	 */
	async getProfileLinks(): Promise<ProfileLink[]> {
		const profile = await this.getProfile('profile_links');
		const raw = profile['profile_links'];

		if (!raw) {
			// First access — seed with defaults and persist
			await this.updateProfile('profile_links', JSON.stringify(DEFAULT_PROFILE_LINKS));
			return [...DEFAULT_PROFILE_LINKS];
		}

		try {
			const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}

	/**
	 * Replace the entire links list (used after add / edit / remove / reorder on the client).
	 */
	async saveProfileLinks(links: ProfileLink[]): Promise<void> {
		await this.updateProfile('profile_links', JSON.stringify(links));
	}

	/**
	 * Upsert a single link by its id. If the id doesn't exist yet, the link is appended.
	 */
	async upsertProfileLink(link: ProfileLink): Promise<ProfileLink[]> {
		const links = await this.getProfileLinks();
		const idx = links.findIndex((l) => l.id === link.id);
		if (idx >= 0) {
			links[idx] = link;
		} else {
			links.push(link);
		}
		await this.saveProfileLinks(links);
		return links;
	}

	/**
	 * Remove a link by id.
	 */
	async removeProfileLink(id: string): Promise<ProfileLink[]> {
		let links = await this.getProfileLinks();
		links = links.filter((l) => l.id !== id);
		await this.saveProfileLinks(links);
		return links;
	}

	/**
	 * Update profile from LLM response
	 */
	async updateFromLlmResponse(topic: string, response: string): Promise<void> {
		const normalizedTopic = topic.toLowerCase().replace(/\s+/g, '_') as ProfileKey;

		switch (normalizedTopic) {
			case 'skills': {
				const skills = response
					.split(',')
					.map((s) => s.trim())
					.filter((s) => s.length > 0);
				await this.updateProfile('skills', skills);
				break;
			}
			case 'experience':
				await this.updateProfile('experience', response);
				break;
			case 'job_titles': {
				const titles = response
					.split(',')
					.map((t) => t.trim())
					.filter((t) => t.length > 0);
				await this.updateProfile('job_titles', titles);
				break;
			}
			default:
				if (this.isValidProfileKey(normalizedTopic)) {
					await this.updateProfile(normalizedTopic, response);
				} else {
					console.warn(`Invalid profile key from LLM response: ${normalizedTopic}`);
				}
				break;
		}
	}

	isValidProfileKey(key: string): key is ProfileKey {
		return VALID_PROFILE_KEYS.includes(key as ProfileKey);
	}
}

export interface ProfileMatchAnalysis {
	profile: ProfileData;
	matches: ProfileMatch[];
	missing: string[];
	recommendations: string[];
}

export interface ProfileMatch {
	field: string;
	matchValue: string;
	confidence: number;
}

export interface ProfileUpdateSuggestion {
	field: ProfileKey;
	suggestedValue: string | string[];
	reason: string;
	confidence: number;
}
