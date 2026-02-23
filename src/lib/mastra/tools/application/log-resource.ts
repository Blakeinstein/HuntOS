// src/lib/mastra/tools/application/log-resource.ts
// Tool that allows the job-application-agent to persist research resources
// (company info, job descriptions, role analysis, errors) back to the database
// during the apply pipeline.

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { ApplicationResourceService } from '$lib/services/services/applicationResource';
import type { AuditLogService } from '$lib/services/services/auditLog';

const resourceTypeEnum = z
	.enum(['job_description', 'company_info', 'role_research', 'resume', 'error'])
	.describe(
		'The category of resource being logged: ' +
			'job_description = extracted job posting text, ' +
			'company_info = researched company details, ' +
			'role_research = analysis of the role and requirements, ' +
			'resume = generated resume content, ' +
			'error = an error encountered during the pipeline'
	);

export function createLogResourceTool(
	resourceService: ApplicationResourceService,
	auditLogService: AuditLogService
) {
	return createTool({
		id: 'log-application-resource',
		description:
			'Persist a research resource or artifact gathered during the job application pipeline. ' +
			'Resources include job descriptions fetched from posting pages, company research, ' +
			'role analysis, generated resume content, and error reports. ' +
			'Each resource is linked to a specific application and is visible to the user ' +
			'in the Apply Progress tab of the application detail page. ' +
			'Call this tool whenever you gather meaningful data about the company, role, or ' +
			'application process that should be persisted for the user to review.',
		inputSchema: z.object({
			applicationId: z
				.number()
				.int()
				.positive()
				.describe('The database ID of the application this resource belongs to'),
			resourceType: resourceTypeEnum,
			title: z
				.string()
				.min(1)
				.describe(
					'A short, descriptive title for the resource (e.g. "Job Description", ' +
						'"Company Research: Acme Corp", "Generated Resume", "Form Submission Error")'
				),
			content: z
				.string()
				.min(1)
				.describe(
					'The full content of the resource. For job descriptions, include the complete ' +
						'extracted text. For research, include all gathered details. For errors, include ' +
						'the full error message and context.'
				),
			meta: z
				.record(z.string(), z.unknown())
				.optional()
				.describe(
					'Optional structured metadata to attach to the resource (e.g. source URL, ' +
						'content length, extraction method). Stored as a JSON blob.'
				)
		}),
		outputSchema: z.object({
			success: z.boolean(),
			resourceId: z.number().describe('The database ID of the created resource'),
			message: z.string()
		}),
		execute: async ({ applicationId, resourceType, title, content, meta }) => {
			const finishAudit = auditLogService.start({
				category: resourceType === 'error' ? 'browser' : 'agent',
				agent_id: 'job-application-agent',
				title: `Logging resource: ${title}`,
				meta: {
					applicationId,
					resourceType,
					contentLength: content.length,
					...(meta ?? {})
				}
			});

			try {
				const resourceId = resourceService.create({
					applicationId,
					resourceType,
					title,
					content,
					meta: (meta as Record<string, unknown>) ?? null
				});

				const message =
					`Resource "${title}" (${resourceType}) saved for application #${applicationId}` +
					` — ${content.length} characters`;

				finishAudit({
					status: resourceType === 'error' ? 'warning' : 'success',
					detail: message,
					meta: { resourceId, resourceType, contentLength: content.length }
				});

				return {
					success: true,
					resourceId,
					message
				};
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : 'Unknown error saving resource';

				finishAudit({
					status: 'error',
					detail: `Failed to save resource "${title}": ${errorMessage}`,
					meta: { error: errorMessage }
				});

				return {
					success: false,
					resourceId: -1,
					message: `Failed to save resource: ${errorMessage}`
				};
			}
		}
	});
}
