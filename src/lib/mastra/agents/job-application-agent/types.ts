import { z } from 'zod';

// ── Coercion helpers ────────────────────────────────────────────────

/**
 * Coerce a value to boolean leniently.
 * Accepts actual booleans, and common string representations ("true", "yes", "1", "false", "no", "0").
 * Anything else becomes false.
 */
function coerceBool(val: unknown): boolean {
	if (typeof val === 'boolean') return val;
	if (typeof val === 'number') return val !== 0;
	if (typeof val === 'string') {
		const lower = val.toLowerCase().trim();
		if (lower === 'true' || lower === 'yes' || lower === '1') return true;
		if (lower === 'false' || lower === 'no' || lower === '0') return false;
	}
	return false;
}

/**
 * Coerce a value to a non-negative integer leniently.
 * Accepts numbers and numeric strings. Anything else becomes 0.
 * Clamps to >= 0.
 */
function coerceNonNegInt(val: unknown): number {
	if (typeof val === 'number') return Math.max(0, Math.trunc(val));
	if (typeof val === 'string') {
		const n = parseInt(val, 10);
		if (!isNaN(n)) return Math.max(0, n);
	}
	return 0;
}

/**
 * Build a z.preprocess wrapper that coerces an unknown string value to a
 * member of `known`, falling back to `fallback` if unrecognised.
 */
function coerceEnum<T extends string>(
	known: readonly T[],
	fallback: T
): (val: unknown) => T | unknown {
	return (val: unknown) =>
		typeof val === 'string' && (known as readonly string[]).includes(val) ? val : fallback;
}

// ── Form Field Types ────────────────────────────────────────────────

/**
 * Status of a discovered form field during the application process.
 */
const FIELD_STATUS_VALUES = ['filled', 'missing', 'skipped', 'error', 'best_fit'] as const;

export const fieldStatusEnum = z
	.preprocess(
		coerceEnum(FIELD_STATUS_VALUES, 'error'),
		z
			.enum(FIELD_STATUS_VALUES)
			.describe(
				'The outcome of attempting to fill this field. ' +
					'"best_fit" means profile data was unavailable so the most neutral/reasonable available option was chosen.'
			)
	)
	.describe('The outcome of attempting to fill this field. Unknown values are coerced to "error".');

export type FieldStatus = z.infer<typeof fieldStatusEnum>;

/**
 * Valid HTML input / element types for a form field.
 */
const FIELD_TYPE_VALUES = [
	'text',
	'email',
	'tel',
	'url',
	'textarea',
	'select',
	'combobox',
	'checkbox',
	'radio',
	'file',
	'date',
	'number',
	'password',
	'hidden',
	'other'
] as const;

/**
 * A single form field discovered and (optionally) filled during application.
 */
export const applicationFieldSchema = z.object({
	field_name: z.string().describe('The field name, label, or aria-label as seen on the page'),
	field_type: z
		.preprocess(
			coerceEnum(FIELD_TYPE_VALUES, 'other'),
			z.enum(FIELD_TYPE_VALUES).describe('The HTML input type or element type')
		)
		.describe('The HTML input type or element type. Unknown values are coerced to "other".'),
	selector: z
		.string()
		.nullable()
		.optional()
		.describe('The CSS selector or snapshot ref used to interact with this field'),
	is_required: z
		.preprocess(coerceBool, z.boolean())
		.describe('Whether the field is marked as required'),
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

const END_REASON_VALUES = [
	'success',
	'blocked',
	'closed',
	'already_applied',
	'error',
	'cancelled'
] as const;

/**
 * The outcome of an application attempt — what the agent returns as
 * structured output after navigating the application form.
 */
export const applicationResultSchema = z.object({
	success: z
		.preprocess(coerceBool, z.boolean())
		.describe('Whether the application was submitted successfully'),
	source_url: z.string().describe('The URL that was navigated to for the application'),
	applied_at: z.string().describe('ISO 8601 timestamp of when the application attempt occurred'),
	form_pages_visited: z
		.preprocess(coerceNonNegInt, z.number().int().min(0))
		.describe('Number of distinct form pages/steps the agent navigated through'),
	fields: z
		.array(applicationFieldSchema)
		.describe('All form fields discovered during the application process'),
	fields_filled: z
		.preprocess(coerceNonNegInt, z.number().int().min(0))
		.describe('Count of fields successfully filled'),
	fields_missing: z
		.preprocess(coerceNonNegInt, z.number().int().min(0))
		.describe('Count of required fields that could not be filled'),
	resume_uploaded: z
		.preprocess(coerceBool, z.boolean())
		.describe('Whether a resume file was uploaded during application'),
	cover_letter_provided: z
		.preprocess(coerceBool, z.boolean())
		.describe('Whether a cover letter was entered or uploaded'),
	submitted: z
		.preprocess(coerceBool, z.boolean())
		.describe(
			'Whether the final submit/apply button was clicked. ' +
				'Can be false even when success is true if the form was multi-step and the last step was reached but not confirmed.'
		),
	blocked: z
		.preprocess(coerceBool, z.boolean())
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
		.preprocess(
			// null/undefined are valid — only coerce non-nullish unknown strings
			(val) =>
				val === null || val === undefined ? val : coerceEnum(END_REASON_VALUES, 'error')(val),
			z.enum(END_REASON_VALUES).nullable().optional()
		)
		.describe(
			'The final outcome reason. Use "closed" when the job is no longer accepting applications, ' +
				'"already_applied" if you\'ve already applied, "blocked" for authentication/CAPTCHA issues, ' +
				'"error" for other failures. Unknown values are coerced to "error".'
		),
	end_reason_description: z
		.string()
		.nullable()
		.optional()
		.describe(
			'A detailed explanation of why the application process ended, including specific reasons like "Job posting closed by employer" or "Already applied to this position".'
		),
	screenshot_taken: z
		.preprocess(coerceBool, z.boolean())
		.describe('Whether a screenshot was captured at the end of the attempt')
});

export type ApplicationResult = z.infer<typeof applicationResultSchema>;

// ── End Reason Enum ─────────────────────────────────────────────────

/**
 * The end reason for an application attempt.
 * Uses the same coercion as applicationResultSchema so standalone usage is
 * equally resilient to LLM hallucinations.
 */
export const applicationEndReasonEnum = z
	.preprocess(coerceEnum(END_REASON_VALUES, 'error'), z.enum(END_REASON_VALUES))
	.describe(
		'The final outcome reason of an application attempt. Unknown values are coerced to "error".'
	);

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
