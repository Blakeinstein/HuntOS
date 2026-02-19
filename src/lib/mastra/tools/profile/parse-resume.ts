// src/lib/mastra/tools/profile/parse-resume.ts
// Tool that receives raw resume text and extracts structured profile data from it.

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { ProfileService, ProfileKey } from '$lib/services/services/profile';
import type { AuditLogService } from '$lib/services/services/auditLog';

export function createParseResumeTool(
	profileService: ProfileService,
	auditLogService: AuditLogService
) {
	return createTool({
		id: 'parse-resume',
		description:
			'Parse raw resume text provided by the user and extract structured profile data from it. ' +
			'The LLM should read the resume text, identify relevant sections (contact info, experience, ' +
			'education, skills, projects, etc.), and call this tool with the extracted fields. ' +
			'This tool saves the extracted data into the user profile and stores the raw resume text.',
		inputSchema: z.object({
			rawText: z.string().describe('The full raw text content of the resume.'),
			extractedFields: z
				.array(
					z.object({
						key: z.string().describe('The profile key to update (e.g. "name", "skills", "experience").'),
						value: z
							.union([z.string(), z.array(z.string())])
							.describe('The extracted value. Use an array for list-like fields (skills, certifications, etc.).')
					})
				)
				.describe(
					'Structured fields extracted from the resume. Each entry maps to a profile key. ' +
					'Extract as many fields as possible: name, email, phone, location, skills, ' +
					'experience, education, certifications, languages, projects, resume_summary, ' +
					'linkedin_url, github_url, portfolio_url.'
				)
		}),
		outputSchema: z.object({
			success: z.boolean(),
			updatedFields: z.array(z.string()),
			skippedFields: z.array(z.string()),
			message: z.string()
		}),
		execute: async ({ rawText, extractedFields }) => {
			const finishAudit = auditLogService.start({
				category: 'profile',
				agent_id: 'profile-agent',
				title: 'Parsing uploaded resume',
				detail: `Resume text length: ${rawText.length} chars, extracting ${extractedFields.length} fields`,
				meta: {
					resumeLength: rawText.length,
					fieldCount: extractedFields.length,
					fieldKeys: extractedFields.map((f) => f.key)
				}
			});

			const updatedFields: string[] = [];
			const skippedFields: string[] = [];

			try {
				// Store the raw resume text
				await profileService.updateProfile('resume_raw_text', rawText);
				updatedFields.push('resume_raw_text');

				// Process each extracted field
				for (const field of extractedFields) {
					if (!profileService.isValidProfileKey(field.key)) {
						skippedFields.push(field.key);
						continue;
					}

					const key = field.key as ProfileKey;

					// For array fields, append rather than overwrite
					const arrayFields: ProfileKey[] = [
						'skills',
						'certifications',
						'languages',
						'job_titles',
						'preferred_companies',
						'website_urls'
					];

					if (arrayFields.includes(key) && Array.isArray(field.value)) {
						await profileService.appendToProfile(key, field.value);
					} else {
						await profileService.updateProfile(key, field.value);
					}

					updatedFields.push(field.key);
				}

				finishAudit({
					status: 'success',
					detail: `Successfully extracted ${updatedFields.length} fields from resume`,
					meta: {
						updatedFields,
						skippedFields
					}
				});

				return {
					success: true,
					updatedFields,
					skippedFields,
					message:
						`Successfully parsed resume and updated ${updatedFields.length} profile fields.` +
						(skippedFields.length > 0
							? ` Skipped ${skippedFields.length} unrecognized fields: ${skippedFields.join(', ')}.`
							: '')
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Unknown error';

				finishAudit({
					status: 'error',
					detail: `Failed to parse resume: ${message}`,
					meta: { error: message, updatedFields, skippedFields }
				});

				return {
					success: false,
					updatedFields,
					skippedFields,
					message: `Failed to parse resume: ${message}`
				};
			}
		}
	});
}
