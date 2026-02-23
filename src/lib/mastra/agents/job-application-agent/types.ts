import { z } from 'zod';

// ── Form Field Types ────────────────────────────────────────────────

/**
 * Status of a discovered form field during the application process.
 */
export const fieldStatusEnum = z
	.enum(['filled', 'missing', 'skipped', 'error'])
	.describe('The outcome of attempting to fill this field');

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
	screenshot_taken: z
		.boolean()
		.describe('Whether a screenshot was captured at the end of the attempt')
});

export type ApplicationResult = z.infer<typeof applicationResultSchema>;

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
};

/**
 * Schema for validating the request context at runtime.
 */
export const jobApplicationRequestContextSchema = z.object({
	'application-url': z.string().url(),
	'user-profile': z.string(),
	'job-description': z.string(),
	'resume-data': z.string(),
	'resume-file-path': z.string()
});

// ── Routing ─────────────────────────────────────────────────────────

/**
 * Supported application site identifiers.
 * Used by the orchestrator to route to the correct sub-agent.
 */
export type ApplicationSiteId = 'linkedin' | 'greenhouse' | 'lever' | 'generic';

/**
 * Schema for the orchestrator's routing decision output.
 */
export const applicationRoutingDecisionSchema = z.object({
	detected_site: z
		.string()
		.describe(
			'The identified application site or ATS name (e.g. "LinkedIn", "Greenhouse", "Lever")'
		),
	sub_agent_id: z
		.string()
		.describe(
			'The dot-notation ID of the sub-agent to delegate to (e.g. "job-application-agent.linkedin")'
		),
	application_url: z.string().describe('The application URL to pass to the sub-agent'),
	confidence: z
		.enum(['high', 'medium', 'low'])
		.describe('How confident the orchestrator is in the site identification'),
	requires_login: z
		.boolean()
		.describe('Whether the site is likely to require authentication before applying'),
	notes: z
		.string()
		.nullable()
		.optional()
		.describe(
			'Any observations about the application page that might affect the sub-agent strategy'
		)
});

export type ApplicationRoutingDecision = z.infer<typeof applicationRoutingDecisionSchema>;

/**
 * Map of application site identifier to its corresponding sub-agent ID.
 */
export const APPLICATION_SITE_AGENT_MAP: Record<ApplicationSiteId, string> = {
	linkedin: 'job-application-agent.linkedin',
	greenhouse: 'job-application-agent.greenhouse',
	lever: 'job-application-agent.lever',
	generic: 'job-application-agent.generic'
} as const;
