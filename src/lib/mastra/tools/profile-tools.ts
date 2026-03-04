import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { ProfileService, ProfileKey } from '$lib/services/services/profile';

const profileKeyEnum = z.enum([
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
	// Job search preferences
	'desired_location',
	'desired_job_type',
	'desired_work_arrangement',
	'job_search_criteria',
	'years_of_experience',
	// Work authorization & immigration
	'has_active_visa',
	'visa_type',
	'needs_sponsorship',
	'open_to_relocate',
	'current_work_preference',
	'immigration_notes',
	// Additional application notes
	'application_notes',
	// Supplemental links
	'github_url',
	'website_urls',
	// Projects
	'projects',
	// Comprehensive description (prefer saveProfileDescription tool for this)
	'profile_description',
	// Raw content fields (typically set by other tools, not directly)
	'resume_raw_text',
	'scraped_content'
]);

export function createUpdateProfileTool(profileService: ProfileService) {
	return createTool({
		id: 'update-user-profile',
		description:
			'Update a single field in the user profile with structured data extracted from the conversation. ' +
			'Use this tool whenever the user provides information about their professional background, ' +
			'skills, experience, education, contact details, job preferences, work authorization, or links. ' +
			'For saving the comprehensive profile description, prefer the saveProfileDescription tool instead. ' +
			'For array-type fields (skills, certifications, languages, job_titles, preferred_companies, website_urls), ' +
			'pass the value as an array of strings. ' +
			'For work authorization fields use: has_active_visa ("yes"/"no"/"citizen"), visa_type (string), ' +
			'needs_sponsorship ("yes"/"no"/"future"), open_to_relocate ("yes"/"no"/"conditional"), ' +
			'current_work_preference ("remote"/"hybrid"/"onsite"/"flexible"), immigration_notes (string). ' +
			'For application_notes use a free-form string with any extra context the agent should know.',
		inputSchema: z.object({
			key: profileKeyEnum.describe('The profile field to update'),
			value: z
				.union([z.string(), z.array(z.string())])
				.describe(
					'The value to set. Use an array for list-like fields such as skills, certifications, ' +
						'languages, job_titles, preferred_companies, and website_urls.'
				)
		}),
		outputSchema: z.object({
			success: z.boolean(),
			message: z.string()
		}),
		execute: async (inputData) => {
			try {
				await profileService.updateProfile(inputData.key as ProfileKey, inputData.value);
				return {
					success: true,
					message: `Profile field "${inputData.key}" updated successfully.`
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Unknown error';
				return {
					success: false,
					message: `Failed to update profile field "${inputData.key}": ${message}`
				};
			}
		}
	});
}

export function createGetProfileTool(profileService: ProfileService) {
	return createTool({
		id: 'get-user-profile',
		description:
			'Retrieve the current user profile data. Call this at the START of every conversation ' +
			'to understand what information has already been collected. You can fetch the full profile ' +
			'or a specific field. The completeness score tells you how much of the profile is filled in.',
		inputSchema: z.object({
			key: profileKeyEnum
				.optional()
				.describe(
					'Optional specific profile field to retrieve. If omitted, returns the full profile.'
				)
		}),
		outputSchema: z.object({
			profile: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
			completeness: z.number().describe('Profile completeness percentage (0-100)')
		}),
		execute: async (inputData) => {
			try {
				const profile = await profileService.getProfile(inputData.key as ProfileKey | undefined);
				const completeness = await profileService.getCompletenessScore();
				return {
					profile: profile as Record<string, string | string[]>,
					completeness
				};
			} catch (error) {
				console.error('Failed to get profile:', error);
				return { profile: {} as Record<string, string | string[]>, completeness: 0 };
			}
		}
	});
}

export function createGetIncompleteFieldsTool(profileService: ProfileService) {
	return createTool({
		id: 'get-incomplete-fields',
		description:
			'Check which required profile fields are still missing or incomplete. ' +
			'Use this to determine what questions to ask next and to guide the user toward ' +
			'a complete profile. Required fields include: name, email, phone, skills, experience, ' +
			'desired_location, desired_job_type, job_titles, needs_sponsorship, and open_to_relocate.',
		inputSchema: z.object({}),
		outputSchema: z.object({
			incompleteFields: z.array(z.string()),
			totalRequired: z.number(),
			filledCount: z.number()
		}),
		execute: async () => {
			try {
				const incompleteFields = await profileService.getIncompleteFields();
				const totalRequired = 10; // matches the updated required keys in ProfileService
				return {
					incompleteFields,
					totalRequired,
					filledCount: totalRequired - incompleteFields.length
				};
			} catch (error) {
				console.error('Failed to get incomplete fields:', error);
				return {
					incompleteFields: [],
					totalRequired: 0,
					filledCount: 0
				};
			}
		}
	});
}
