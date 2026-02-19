import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { ResumeGenerationService } from '$lib/services/services/resumeGeneration';
import type { AuditLogService } from '$lib/services/services/auditLog';
import type { ResumeHistoryService } from '$lib/services/services/resumeHistory';
import {
	resumeDataSchema,
	experienceSchema,
	educationSchema,
	certificationSchema,
	projectSchema
} from '$lib/services/resume/schema';

export function createGenerateResumeTool(
	resumeGenerationService: ResumeGenerationService,
	auditLogService: AuditLogService,
	resumeHistoryService: ResumeHistoryService
) {
	return createTool({
		id: 'generate-resume',
		description:
			'Generate a tailored, ATS-friendly resume from the user profile for a specific job description. ' +
			'This tool handles the full pipeline: loading the profile, calling the LLM for structured data, ' +
			'and rendering the result through a Handlebars template into Markdown. ' +
			'Pass the full job description text and optionally a template ID (omit to use the default template). ' +
			'Optionally provide a human-readable name for the resume (e.g. "Senior Engineer - Acme Corp"). ' +
			'Returns the rendered Markdown, the structured JSON data, and the template name used.',
		inputSchema: z.object({
			jobDescription: z
				.string()
				.min(1)
				.describe('The full text of the target job posting to tailor the resume for'),
			templateId: z
				.number()
				.optional()
				.describe(
					'Optional ID of the Handlebars template to use for rendering. ' +
						'Omit to use the default template. Call listTemplates first to see available options.'
				),
			resumeName: z
				.string()
				.optional()
				.describe(
					'Optional human-readable name for this resume (e.g. "Senior Engineer - Acme Corp"). ' +
						'If not provided, a name will be derived from the generated data.'
				)
		}),
		outputSchema: z.object({
			success: z.boolean(),
			markdown: z.string().describe('The final resume rendered as Markdown'),
			data: z
				.object({
					name: z.string(),
					professional_profile: z.string(),
					skills: z.array(z.string()),
					experience: z.array(experienceSchema),
					education: z.array(educationSchema),
					certifications: z.array(certificationSchema),
					projects: z.array(projectSchema),
					additional_info: z.record(z.string(), z.string())
				})
				.optional()
				.describe('The structured resume JSON data returned by the LLM'),
			templateName: z.string().describe('Name of the template that was used for rendering'),
			historyId: z.number().optional().describe('ID of the saved resume history entry'),
			message: z.string().describe('Human-readable status message')
		}),
		execute: async ({ jobDescription, templateId, resumeName }) => {
			const finishAudit = auditLogService.start({
				category: 'resume',
				agent_id: 'resume-agent',
				title: 'Generating tailored resume',
				detail:
					`Job description length: ${jobDescription.length} chars` +
					(templateId ? `, template ID: ${templateId}` : ', using default template'),
				meta: {
					jobDescriptionLength: jobDescription.length,
					templateId: templateId ?? null,
					resumeName: resumeName ?? null
				}
			});

			try {
				const result = await resumeGenerationService.generate(jobDescription, templateId);

				// Derive a name if none was provided
				const name = resumeName || deriveResumeName(result.data.name, jobDescription);

				// Save to history
				const historyEntry = resumeHistoryService.create({
					name,
					jobDescription,
					templateId: templateId ?? null,
					templateName: result.templateName,
					model: 'qwen/qwen3-30b-a3b-instruct-2507',
					data: result.data,
					markdown: result.markdown,
					durationMs: null // duration tracked by audit
				});

				const summaryMsg =
					`Resume generated successfully using the "${result.templateName}" template. ` +
					`Includes ${result.data.skills.length} skills, ` +
					`${result.data.experience.length} experience entries, ` +
					`${result.data.education.length} education entries, ` +
					`${result.data.certifications.length} certifications, and ` +
					`${result.data.projects.length} projects. ` +
					`Saved as "${name}" (history #${historyEntry.id}).`;

				finishAudit({
					status: 'success',
					detail: summaryMsg,
					meta: {
						historyId: historyEntry.id,
						filePath: historyEntry.file_path,
						resumeName: name,
						skillCount: result.data.skills.length,
						experienceCount: result.data.experience.length,
						educationCount: result.data.education.length,
						certificationCount: result.data.certifications.length,
						projectCount: result.data.projects.length,
						templateName: result.templateName
					}
				});

				return {
					success: true,
					markdown: result.markdown,
					data: result.data,
					templateName: result.templateName,
					historyId: historyEntry.id,
					message: summaryMsg
				};
			} catch (error) {
				const message =
					error instanceof Error ? error.message : 'Unknown error during resume generation';

				finishAudit({
					status: 'error',
					detail: `Failed to generate resume: ${message}`,
					meta: { error: message }
				});

				return {
					success: false,
					markdown: '',
					data: undefined,
					templateName: '',
					historyId: undefined,
					message: `Failed to generate resume: ${message}`
				};
			}
		}
	});
}

/**
 * Derive a human-readable resume name from the candidate name and job description.
 * Tries to extract a job title or company from the first few lines.
 */
function deriveResumeName(candidateName: string, jobDescription: string): string {
	// Try to extract something meaningful from the first line(s)
	const firstLine = jobDescription.trim().split('\n')[0].trim();
	const snippet = firstLine.length > 60 ? firstLine.slice(0, 57) + '...' : firstLine;

	if (snippet.length > 5) {
		return `${candidateName} - ${snippet}`;
	}

	const now = new Date();
	const dateStr = now.toISOString().slice(0, 10);
	return `${candidateName} - Resume ${dateStr}`;
}
