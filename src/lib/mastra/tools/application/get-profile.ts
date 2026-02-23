// src/lib/mastra/tools/application/get-profile.ts
// Read-only profile access tool scoped for the job-application-agent.
// Returns the user's profile data so the agent can map fields to form inputs.

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { ProfileService } from '$lib/services/services/profile';

export function createGetProfileTool(profileService: ProfileService) {
	return createTool({
		id: 'get-application-profile',
		description:
			'Retrieve the current user profile data for use during job application form filling. ' +
			'Returns all profile fields including name, email, phone, location, skills, experience, ' +
			'education, certifications, links (LinkedIn, GitHub, portfolio), job preferences, and more. ' +
			'Call this tool at the START of every application attempt to understand what data is ' +
			'available for filling form fields. The completeness score indicates how much of the ' +
			'profile is populated — a low score means more fields may end up as "missing" during ' +
			'form filling.',
		inputSchema: z.object({
			key: z
				.string()
				.optional()
				.describe(
					'Optional specific profile field to retrieve (e.g. "name", "email", "skills", ' +
						'"experience", "education", "linkedin_url"). If omitted, returns the full profile.'
				)
		}),
		outputSchema: z.object({
			profile: z
				.record(z.string(), z.union([z.string(), z.array(z.string())]))
				.describe('The profile data as key-value pairs'),
			completeness: z
				.number()
				.describe('Profile completeness percentage (0-100)'),
			incompleteFields: z
				.array(z.string())
				.describe('List of required profile fields that are still missing or empty')
		}),
		execute: async ({ key }) => {
			try {
				const profile = await profileService.getProfile(
					key as Parameters<typeof profileService.getProfile>[0]
				);
				const completeness = await profileService.getCompletenessScore();
				const incompleteFields = await profileService.getIncompleteFields();

				return {
					profile: profile as Record<string, string | string[]>,
					completeness,
					incompleteFields
				};
			} catch (error) {
				console.error('[get-application-profile] Failed to get profile:', error);
				return {
					profile: {} as Record<string, string | string[]>,
					completeness: 0,
					incompleteFields: []
				};
			}
		}
	});
}
