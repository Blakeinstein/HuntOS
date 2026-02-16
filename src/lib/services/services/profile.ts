import type { Database } from './database';

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
	| 'linkedin_url';

export interface ProfileData {
	[key: string]: string | string[];
}

export interface ProfileUpdate {
	key: ProfileKey;
	value: string | string[];
	source: 'manual' | 'llm' | 'job_match';
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

		// This is a placeholder. In a real implementation, you would use an LLM
		// or other NLP techniques to analyze the job description against the profile.
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
		// This is a placeholder. In a real implementation, you would use an LLM
		// to generate suggestions.
		console.log(
			'Suggesting profile updates for job description (placeholder):',
			jobDescription.substring(0, 100)
		);
		return [];
	}

	/**
	 * Get profile completeness score
	 */
	async getCompletenessScore(): Promise<number> {
		const requiredKeys: ProfileKey[] = ['name', 'email', 'phone', 'skills', 'experience'];
		const profile = await this.getProfile();

		let filledCount = 0;
		const totalCount = requiredKeys.length;

		for (const key of requiredKeys) {
			const value = profile[key];
			if (value && (typeof value === 'string' ? value.length > 0 : value.length > 0)) {
				filledCount++;
			}
		}

		return Math.round((filledCount / totalCount) * 100);
	}

	/**
	 * Get incomplete profile fields
	 */
	async getIncompleteFields(): Promise<ProfileKey[]> {
		const requiredKeys: ProfileKey[] = ['name', 'email', 'phone', 'skills', 'experience'];
		const profile = await this.getProfile();

		return requiredKeys.filter((key) => {
			const value = profile[key];
			return !value || (typeof value === 'string' ? value.length === 0 : value.length === 0);
		});
	}

	/**
	 * Update profile from LLM response
	 */
	async updateFromLlmResponse(topic: string, response: string): Promise<void> {
		const normalizedTopic = topic.toLowerCase().replace(/\s+/g, '_') as ProfileKey;

		switch (normalizedTopic) {
			case 'skills': {
				const skills = response.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
				await this.updateProfile('skills', skills);
				break;
			}
			case 'experience':
				await this.updateProfile('experience', response);
				break;
			case 'job_titles': {
				const titles = response.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
				await this.updateProfile('job_titles', titles);
				break;
			}
			default:
				// Be careful with this, ensure normalizedTopic is a valid ProfileKey
				if (this.isValidProfileKey(normalizedTopic)) {
					await this.updateProfile(normalizedTopic, response);
				} else {
					console.warn(`Invalid profile key from LLM response: ${normalizedTopic}`);
				}
				break;
		}
	}

	private isValidProfileKey(key: string): key is ProfileKey {
		const validKeys: ProfileKey[] = [
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
			'linkedin_url'
		];
		return validKeys.includes(key as ProfileKey);
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
