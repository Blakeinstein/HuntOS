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
	'linkedin_url'
]);

export function createUpdateProfileTool(profileService: ProfileService) {
	return createTool({
		id: 'update-user-profile',
		description:
			'Update the user profile with structured data extracted from the conversation. ' +
			'Use this tool whenever the user provides information about their professional background, ' +
			'skills, experience, education, contact details, or job preferences.',
		inputSchema: z.object({
			key: profileKeyEnum.describe('The profile field to update'),
			value: z
				.union([z.string(), z.array(z.string())])
				.describe(
					'The value to set. Use an array for fields like skills, certifications, languages, job_titles, and preferred_companies.'
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
			'Retrieve the current user profile data. Use this to check what information ' +
			'has already been provided before asking the user for more details.',
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
			'Use this to guide the user on what information they still need to provide.',
		inputSchema: z.object({}),
		outputSchema: z.object({
			incompleteFields: z.array(z.string()),
			totalRequired: z.number(),
			filledCount: z.number()
		}),
		execute: async () => {
			try {
				const incompleteFields = await profileService.getIncompleteFields();
				const requiredCount = 5; // matches ProfileService.getCompletenessScore required keys
				return {
					incompleteFields,
					totalRequired: requiredCount,
					filledCount: requiredCount - incompleteFields.length
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
