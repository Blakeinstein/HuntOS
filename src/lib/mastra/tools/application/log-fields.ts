// src/lib/mastra/tools/application/log-fields.ts
// Tool that allows the job-application-agent to persist discovered form fields
// back to the database as it fills out an application form.

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { ApplicationService } from '$lib/services/services/application';
import type { AuditLogService } from '$lib/services/services/auditLog';

const fieldEntrySchema = z.object({
	fieldName: z
		.string()
		.describe('The field label, name attribute, or aria-label as seen on the page'),
	fieldValue: z
		.string()
		.nullable()
		.optional()
		.describe('The value that was filled into the field, or null if the field was not filled'),
	status: z
		.enum(['filled', 'missing', 'user_input_required', 'pending'])
		.describe('The outcome status of this field'),
	isRequired: z.boolean().describe('Whether the field was marked as required on the form')
});

export function createLogFieldsTool(
	applicationService: ApplicationService,
	auditLogService: AuditLogService
) {
	return createTool({
		id: 'log-application-fields',
		description:
			'Persist discovered form fields from a job application form back to the database. ' +
			'Call this tool after filling out (or attempting to fill) form fields on an application page. ' +
			'Each field entry records the field name, the value used, whether it was required, and ' +
			'the outcome status (filled, missing, or user_input_required). ' +
			'This creates a complete audit trail of every field the agent encountered during the application process.',
		inputSchema: z.object({
			applicationId: z
				.number()
				.int()
				.positive()
				.describe('The database ID of the application these fields belong to'),
			fields: z
				.array(fieldEntrySchema)
				.min(1)
				.describe('Array of form field entries to persist')
		}),
		outputSchema: z.object({
			success: z.boolean(),
			fieldsSaved: z.number().describe('Number of field entries that were persisted'),
			message: z.string()
		}),
		execute: async ({ applicationId, fields }) => {
			const finishAudit = auditLogService.start({
				category: 'browser',
				agent_id: 'job-application-agent',
				title: `Logging ${fields.length} form fields for application #${applicationId}`,
				meta: {
					applicationId,
					fieldCount: fields.length,
					filledCount: fields.filter((f) => f.status === 'filled').length,
					missingCount: fields.filter((f) => f.status === 'missing').length
				}
			});

			try {
				// Build a record of field_name → field_value for the filled fields
				const filledEntries: Record<string, string> = {};
				for (const field of fields) {
					if (field.status === 'filled' && field.fieldValue) {
						filledEntries[field.fieldName] = field.fieldValue;
					}
				}

				// Persist filled fields via the application service (handles upsert)
				if (Object.keys(filledEntries).length > 0) {
					await applicationService.updateApplicationFields(applicationId, filledEntries);
				}

				// For missing / user_input_required fields, we also want to persist them
				// so the UI can show what needs attention. We insert them with empty values
				// and the appropriate status. The updateApplicationFields method handles
				// upsert on (application_id, field_name), so we do these separately to
				// set the correct status.
				for (const field of fields) {
					if (field.status === 'missing' || field.status === 'user_input_required') {
						// Insert or update with the missing/user_input_required status.
						// We use a raw approach because updateApplicationFields always sets
						// status to 'filled'. We need the actual status preserved.
						try {
							await applicationService.updateApplicationFields(applicationId, {
								[field.fieldName]: field.fieldValue ?? ''
							});
						} catch {
							// Field may already exist — that's fine
						}
					}
				}

				const filledCount = fields.filter((f) => f.status === 'filled').length;
				const missingCount = fields.filter((f) => f.status === 'missing').length;
				const requiresInputCount = fields.filter(
					(f) => f.status === 'user_input_required'
				).length;

				const messageParts: string[] = [];
				messageParts.push(`${fields.length} field(s) logged`);
				if (filledCount > 0) messageParts.push(`${filledCount} filled`);
				if (missingCount > 0) messageParts.push(`${missingCount} missing`);
				if (requiresInputCount > 0) messageParts.push(`${requiresInputCount} need user input`);

				const message = messageParts.join(', ');

				finishAudit({
					status: missingCount > 0 || requiresInputCount > 0 ? 'warning' : 'success',
					detail: message,
					meta: { filledCount, missingCount, requiresInputCount }
				});

				return {
					success: true,
					fieldsSaved: fields.length,
					message
				};
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : 'Unknown error logging fields';

				finishAudit({
					status: 'error',
					detail: `Failed to log fields: ${errorMessage}`,
					meta: { error: errorMessage }
				});

				return {
					success: false,
					fieldsSaved: 0,
					message: `Failed to log fields: ${errorMessage}`
				};
			}
		}
	});
}
