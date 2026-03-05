import { z } from 'zod';

// ── Form Field Types ────────────────────────────────────────────────

/**
 * Status of a discovered form field during the application process.
 */
export const fieldStatusEnum = z
	.enum(['filled', 'missing', 'skipped', 'error', 'best_fit'])
	.describe(
		'The outcome of attempting to fill this field. ' +
			'"best_fit" means profile data was unavailable so the most neutral/reasonable available option was chosen.'
	);

export type FieldStatus = z.infer<typeof fieldStatusEnum>;

/**
 * A single form field discovered and (optionally) filled during application.
 */
export const applicationFieldSchema = z.object({
	field_name: z.string().describe('The field name, label, or aria-label as seen on the page'),
	field_type: z
		.enum([
			'text',
			'email',
			'tel',
			'url',
			'textarea',
			'select',
			'checkbox',
			'radio',
			'file',
			'date',
			'number',
			'password',
			'hidden',
			'other'
		])
		.describe('The HTML input type or element type'),
	selector: z
		.string()
		.nullable()
		.optional()
		.describe('The CSS selector or snapshot ref used to interact with this field'),
	is_required: z.boolean().describe('Whether the field is marked as required'),
	status: fieldStatusEnum,
	value_used: z
		.string()
		.nullable()
		.optional()
		.describe('The value that was filled into the field, or null if not filled'),
	error_reason: z
		.string()
		.nullable()
		.optional()
		.describe(
			'Why this field could not be filled (e.g. "No matching profile data", "CAPTCHA detected")'
		)
});

export type ApplicationField = z.infer<typeof applicationFieldSchema>;

// ── Application Result ──────────────────────────────────────────────

/**
 * The outcome of an application attempt — what the agent returns as
 * structured output after navigating the application form.
 */
export const applicationResultSchema = z.object({
	success: z.boolean().describe('Whether the application was submitted successfully'),
	source_url: z.string().describe('The URL that was navigated to for the application'),
	applied_at: z.string().describe('ISO 8601 timestamp of when the application attempt occurred'),
	form_pages_visited: z
		.number()
		.int()
		.min(0)
		.describe('Number of distinct form pages/steps the agent navigated through'),
	fields: z
		.array(applicationFieldSchema)
		.describe('All form fields discovered during the application process'),
	fields_filled: z.number().int().min(0).describe('Count of fields successfully filled'),
	fields_missing: z
		.number()
		.int()
		.min(0)
		.describe('Count of required fields that could not be filled'),
	resume_uploaded: z.boolean().describe('Whether a resume file was uploaded during application'),
	cover_letter_provided: z.boolean().describe('Whether a cover letter was entered or uploaded'),
	submitted: z
		.boolean()
		.describe(
			'Whether the final submit/apply button was clicked. ' +
				'Can be false even when success is true if the form was multi-step and the last step was reached but not confirmed.'
		),
	blocked: z
		.boolean()
		.describe(
			'Whether the page required authentication, showed a CAPTCHA, or was otherwise blocked'
		),
	blocked_reason: z
		.string()
		.nullable()
		.optional()
		.describe(
			'Description of why the application was blocked (e.g. "Login required", "CAPTCHA detected")'
		),
	errors: z.array(z.string()).describe('Any errors encountered during the application process'),
	notes: z
		.string()
		.nullable()
		.optional()
		.describe(
			'Additional agent notes about the application attempt (unusual form layout, multi-step process, etc.)'
		),
	end_reason: z
		.enum(['success', 'blocked', 'closed', 'already_applied', 'error', 'cancelled'])
		.nullable()
		.optional()
		.describe(
			'The final outcome reason. Use "closed" when the job is no longer accepting applications, "already_applied" if you\'ve already applied, "blocked" for authentication/CAPTCHA issues, "error" for other failures.'
		),
	end_reason_description: z
		.string()
		.nullable()
		.optional()
		.describe(
			'A detailed explanation of why the application process ended, including specific reasons like "Job posting closed by employer" or "Already applied to this position".'
		),
	screenshot_taken: z
		.boolean()
		.describe('Whether a screenshot was captured at the end of the attempt')
});

export type ApplicationResult = z.infer<typeof applicationResultSchema>;

// ── End Reason Enum ─────────────────────────────────────────────────

/**
 * The end reason for an application attempt.
 */
export const applicationEndReasonEnum = z
	.enum(['success', 'blocked', 'closed', 'already_applied', 'error', 'cancelled'])
	.describe('The final outcome reason of an application attempt');

export type ApplicationEndReason = z.infer<typeof applicationEndReasonEnum>;

// ── Request Context ─────────────────────────────────────────────────

/**
 * Request context type for job application agents.
 * These values are injected at runtime via RequestContext.
 */
export type JobApplicationRequestContext = {
	/** The job application URL to navigate to and fill out */
	'application-url': string;
	/** JSON-serialized user profile data for filling form fields */
	'user-profile': string;
	/** The job description text (for context when answering questions) */
	'job-description': string;
	/** JSON-serialized resume data (structured JSON from resume generation) */
	'resume-data': string;
	/** Path to the generated resume PDF file for upload, or empty string if none */
	'resume-file-path': string;
	/** The detected site/ATS name (e.g. "LinkedIn", "Greenhouse", "Generic") */
	'detected-site': string;
	/** Site-specific supplemental instructions loaded from prompts/job-application-agent/sites/ */
	'site-instructions': string;
	/** Absolute path to the per-run screenshot directory for this application attempt */
	'screenshot-dir': string;
};

/**
 * Schema for validating the request context at runtime.
 */
export const jobApplicationRequestContextSchema = z.object({
	'application-url': z.string().url(),
	'user-profile': z.string(),
	'job-description': z.string(),
	'resume-data': z.string(),
	'resume-file-path': z.string(),
	'detected-site': z.string(),
	'site-instructions': z.string(),
	'screenshot-dir': z.string()
});
