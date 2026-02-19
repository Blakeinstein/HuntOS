// src/lib/mastra/tools/profile/save-description.ts
// Tool that saves the comprehensive semi-structured profile description.
// The LLM composes the description from all gathered data and calls this tool to persist it.

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { ProfileService } from '$lib/services/services/profile';
import type { AuditLogService } from '$lib/services/services/auditLog';

export function createSaveProfileDescriptionTool(
	profileService: ProfileService,
	auditLogService: AuditLogService
) {
	return createTool({
		id: 'save-profile-description',
		description:
			'Save a comprehensive semi-structured profile description that summarizes everything known ' +
			'about the user. This description is the primary artifact consumed by other agents (job search, ' +
			'application filling) so it must be thorough and well-organized. ' +
			'\n\nThe description should be written in semi-structured markdown and cover ALL of the following ' +
			'sections (omit a section only if there is genuinely no information available):\n' +
			'- **Job Search Preferences**: desired roles, locations, job types, work arrangement, salary expectations, specific criteria\n' +
			'- **Professional Summary**: a 2-4 sentence elevator pitch\n' +
			'- **Technical Skills**: languages, frameworks, tools, platforms\n' +
			'- **Soft Skills**: leadership, communication, etc.\n' +
			'- **Work Experience**: for each role — company, title, dates, key responsibilities and achievements\n' +
			'- **Projects**: notable personal/open-source/professional projects with descriptions\n' +
			'- **Education**: degrees, institutions, dates, notable coursework or honors\n' +
			'- **Certifications & Training**: any professional certifications\n' +
			'- **Languages**: spoken/written languages and proficiency\n' +
			'- **Online Presence**: links to GitHub, LinkedIn, portfolio, etc.\n' +
			'- **Additional Context**: anything else relevant (availability, visa status, relocation preferences, etc.)\n' +
			'\n\nCall this tool once you have gathered enough information to produce a useful description. ' +
			'You can call it again later to update the description as more information becomes available.',
		inputSchema: z.object({
			description: z
				.string()
				.min(100)
				.describe(
					'The comprehensive semi-structured profile description in markdown format. ' +
					'Should be at least a few paragraphs covering the sections listed above.'
				),
			summary: z
				.string()
				.max(500)
				.describe(
					'A short (1-3 sentence) summary of the profile for quick reference by other agents. ' +
					'Example: "Senior full-stack engineer with 8 years of experience in TypeScript/React/Node.js, ' +
					'seeking remote senior or staff-level positions in fintech or developer tooling."'
				),
			completenessNotes: z
				.string()
				.optional()
				.describe(
					'Optional notes about what information is still missing or could be improved. ' +
					'This helps the agent know what to ask about in future conversations.'
				)
		}),
		outputSchema: z.object({
			success: z.boolean(),
			descriptionLength: z.number(),
			message: z.string()
		}),
		execute: async ({ description, summary, completenessNotes }) => {
			const finishAudit = auditLogService.start({
				category: 'profile',
				agent_id: 'profile-agent',
				title: 'Saving comprehensive profile description',
				detail: `Description length: ${description.length} chars`,
				meta: {
					descriptionLength: description.length,
					summaryLength: summary.length,
					hasCompletenessNotes: !!completenessNotes
				}
			});

			try {
				// Save the full description
				await profileService.updateProfile('profile_description', description);

				// Save the short summary as the resume_summary if one doesn't already exist,
				// or always update it since this is the latest understanding
				await profileService.updateProfile('resume_summary', summary);

				finishAudit({
					status: 'success',
					detail: `Saved profile description (${description.length} chars) and summary (${summary.length} chars)`,
					meta: {
						descriptionLength: description.length,
						summaryLength: summary.length,
						completenessNotes: completenessNotes || null
					}
				});

				const completenessScore = await profileService.getCompletenessScore();

				return {
					success: true,
					descriptionLength: description.length,
					message:
						`Successfully saved comprehensive profile description (${description.length} characters). ` +
						`Profile completeness is now ${completenessScore}%.` +
						(completenessNotes
							? ` Notes for future improvement: ${completenessNotes}`
							: '')
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Unknown error';

				finishAudit({
					status: 'error',
					detail: `Failed to save profile description: ${message}`,
					meta: { error: message }
				});

				return {
					success: false,
					descriptionLength: 0,
					message: `Failed to save profile description: ${message}`
				};
			}
		}
	});
}
