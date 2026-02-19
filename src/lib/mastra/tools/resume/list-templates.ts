import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { ResumeTemplateService } from '$lib/services/services/resumeTemplate';

export function createListTemplatesTool(templateService: ResumeTemplateService) {
	return createTool({
		id: 'list-resume-templates',
		description:
			'List all available resume Handlebars templates. Returns each template with its ID, name, ' +
			'whether it is the built-in default, and a short preview of its content. ' +
			'Use this at the start of a conversation to know which templates are available, ' +
			'and when the user asks about switching templates or creating new ones.',
		inputSchema: z.object({}),
		outputSchema: z.object({
			templates: z.array(
				z.object({
					id: z.number().describe('Template ID — pass this to generateResume as templateId'),
					name: z.string().describe('Human-readable template name'),
					isDefault: z.boolean().describe('Whether this is the built-in default template'),
					contentPreview: z
						.string()
						.describe('First 200 characters of the template content for reference'),
					updatedAt: z.string().describe('When the template was last modified')
				})
			),
			count: z.number().describe('Total number of templates available'),
			message: z.string()
		}),
		execute: async () => {
			try {
				const templates = templateService.list();

				return {
					templates: templates.map((tpl) => ({
						id: tpl.id,
						name: tpl.name,
						isDefault: !!tpl.is_default,
						contentPreview:
							tpl.content.length > 200
								? tpl.content.substring(0, 200) + '…'
								: tpl.content,
						updatedAt: tpl.updated_at
					})),
					count: templates.length,
					message:
						templates.length === 1
							? 'There is 1 template available (the default).'
							: `There are ${templates.length} templates available.`
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Unknown error';
				return {
					templates: [],
					count: 0,
					message: `Failed to list templates: ${message}`
				};
			}
		}
	});
}
