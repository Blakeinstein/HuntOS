import { generateObject, generateText, wrapLanguageModel, extractReasoningMiddleware } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import Handlebars from 'handlebars';
import { OPENROUTER_API_KEY } from '$env/static/private';
import type { ProfileService, ProfileData } from './profile';
import type { ResumeTemplateService, ResumeTemplate } from './resumeTemplate';
import { resumeDataSchema, type ResumeData } from '../resume/schema';
import untruncateJson from 'untruncate-json';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Types ────────────────────────────────────────────────────────

export interface ResumeGenerationConfig {
	/** OpenRouter model identifier (default: qwen/qwen3-30b-a3b-instruct-2507) */
	model: string;
	/** Request timeout in milliseconds (default: 120 000 — 2 minutes) */
	timeoutMs: number;
	/** Maximum output tokens for the LLM (default: 16384) */
	maxOutputTokens: number;
}

export interface ResumeGenerationResult {
	/** The final resume rendered as Markdown through the Handlebars template */
	markdown: string;
	/** The structured JSON data returned by the LLM (before templating) */
	data: ResumeData;
	/** Which template was used */
	templateName: string;
}

const DEFAULT_CONFIG: ResumeGenerationConfig = {
	model: 'qwen/qwen3-30b-a3b-instruct-2507',
	timeoutMs: 120_000,
	maxOutputTokens: 16_384
};

// ── Service ──────────────────────────────────────────────────────

/**
 * Orchestrates resume generation end-to-end:
 *
 * 1. Loads the user profile and serialises it to plain text.
 * 2. Reads the LLM prompt template from disk and fills in placeholders.
 * 3. Calls the LLM via AI SDK `generateObject` to produce structured JSON.
 * 4. Renders the JSON through a Handlebars resume template into Markdown.
 *
 * Adapted from https://github.com/Blakeinstein/resume-ai (MIT).
 */
export class ResumeGenerationService {
	private profileService: ProfileService;
	private templateService: ResumeTemplateService;
	private config: ResumeGenerationConfig;
	private openrouter: ReturnType<typeof createOpenRouter>;
	private promptTemplate: string | null = null;

	constructor(
		profileService: ProfileService,
		templateService: ResumeTemplateService,
		config?: Partial<ResumeGenerationConfig>
	) {
		this.profileService = profileService;
		this.templateService = templateService;
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.openrouter = createOpenRouter({ apiKey: OPENROUTER_API_KEY });
	}

	// ── Public API ────────────────────────────────────────────────

	/**
	 * Generate a tailored resume for a given job description.
	 *
	 * @param jobDescription  The full text of the target job posting.
	 * @param templateId      Optional template id. Falls back to the default.
	 */
	async generate(jobDescription: string, templateId?: number): Promise<ResumeGenerationResult> {
		// 1. Load profile → plain text
		const profile = await this.profileService.getProfile();
		const resumeText = this.profileToText(profile);

		// 2. Build the LLM prompt
		const prompt = this.buildPrompt(resumeText, jobDescription);

		// 3. Call the LLM for structured JSON
		const data = await this.callLLM(prompt);

		// 4. Resolve the Handlebars template
		const template = templateId
			? (this.templateService.getById(templateId) ?? this.templateService.getDefault())
			: this.templateService.getDefault();

		// 5. Render Markdown
		const markdown = this.applyTemplate(template, data);

		return {
			markdown,
			data,
			templateName: template.name
		};
	}

	// ── LLM ──────────────────────────────────────────────────────

	/**
	 * Calls the LLM to produce structured resume JSON.
	 *
	 * Strategy (layered, most robust → most lenient):
	 *
	 * 1. **`generateObject`** with the Zod schema (structured output / `json_schema`
	 *    response format). The provider sends the schema natively so the model is
	 *    constrained. Uses `experimental_repairText` with `untruncate-json` so
	 *    that output truncated by token limits is automatically completed before
	 *    validation.
	 *
	 * 2. **`generateText` fallback** — strips `<think>` tags and code fences,
	 *    applies `untruncate-json`, and validates with Zod manually.
	 *
	 * Both paths set an explicit `maxOutputTokens` (default 16 384) to avoid
	 * silent truncation by the provider's default completion limit.
	 */
	private async callLLM(prompt: string): Promise<ResumeData> {
		const baseModel = this.openrouter(this.config.model);

		// Wrap with reasoning-extraction middleware so `<think>` blocks from
		// thinking models (Qwen3, DeepSeek R1, etc.) are stripped before the
		// output parser sees the text.
		const model = wrapLanguageModel({
			model: baseModel,
			middleware: [extractReasoningMiddleware({ tagName: 'think' })]
		});

		const sharedSettings = {
			maxOutputTokens: this.config.maxOutputTokens,
			abortSignal: AbortSignal.timeout(this.config.timeoutMs)
		};

		// ── Primary: generateObject (native structured output) ────
		try {
			const result = await generateObject({
				model,
				schema: resumeDataSchema,
				schemaName: 'Resume',
				schemaDescription:
					'ATS-friendly resume with professional profile, skills, experience, education, certifications, projects, and additional info.',
				prompt,
				...sharedSettings,

				// Repair truncated / malformed JSON before validation.
				// Called automatically when the raw text fails to parse or
				// doesn't match the schema.
				experimental_repairText: async ({ text }) => {
					console.warn(
						'[ResumeGeneration] repairText invoked. finishReason may be "length" (truncation). Attempting repair…',
						'text length:',
						text.length
					);
					return this.repairJson(text);
				}
			});

			if (result.finishReason === 'length') {
				console.warn(
					'[ResumeGeneration] generateObject finished with reason "length" — output may have been truncated.',
					'Tokens used:',
					result.usage
				);
			}

			return result.object;
		} catch (primaryError) {
			console.warn(
				'[ResumeGeneration] generateObject failed, falling back to generateText:',
				primaryError instanceof Error ? primaryError.message : primaryError
			);
		}

		// ── Fallback: generateText → extract + repair + validate ──
		const { text, finishReason, usage } = await generateText({
			model,
			prompt,
			...sharedSettings
		});

		if (finishReason === 'length') {
			console.warn(
				'[ResumeGeneration] Fallback generateText finished with reason "length" — output truncated.',
				'Tokens used:',
				usage
			);
		}

		// Try to extract and repair JSON from the raw text
		const json = this.extractAndRepairJson(text);
		if (!json) {
			console.error(
				'[ResumeGeneration] Could not extract JSON from LLM response.',
				`finishReason=${finishReason}`,
				'Raw text (first 2000 chars):',
				text.slice(0, 2000)
			);
			throw new Error(
				`Resume generation failed: the model did not return valid JSON (finishReason=${finishReason}). ` +
					'Try again or switch to a different model.'
			);
		}

		const result = resumeDataSchema.safeParse(json);
		if (!result.success) {
			console.error(
				'[ResumeGeneration] Extracted JSON did not match schema.',
				`finishReason=${finishReason}`,
				'Validation errors:',
				JSON.stringify(result.error.issues ?? result.error, null, 2)
			);
			console.error(
				'[ResumeGeneration] Extracted JSON (first 2000 chars):',
				JSON.stringify(json).slice(0, 2000)
			);
			throw new Error(
				`Resume generation failed: the model returned JSON that did not match the expected schema (finishReason=${finishReason}). ` +
					'Try again or switch to a different model.'
			);
		}

		return result.data;
	}

	// ── JSON repair helpers ──────────────────────────────────────

	/**
	 * Attempt to repair a raw text string that should be JSON.
	 * Used by `experimental_repairText` in `generateObject`.
	 *
	 * 1. Strips `<think>` blocks, code fences, and surrounding prose.
	 * 2. Applies `untruncate-json` to close any truncated structures.
	 * 3. Returns the repaired string, or `null` if unrecoverable.
	 */
	private repairJson(raw: string): string | null {
		let text = this.stripWrappers(raw);

		// Try parsing as-is first
		try {
			JSON.parse(text);
			return text;
		} catch {
			// needs repair
		}

		// Apply untruncate-json to close truncated JSON structures
		try {
			const repaired = untruncateJson(text);
			JSON.parse(repaired); // verify it's now valid
			console.info(
				'[ResumeGeneration] untruncate-json successfully repaired truncated output.',
				`Original length: ${text.length}, repaired length: ${repaired.length}`
			);
			return repaired;
		} catch {
			// untruncate couldn't fix it
		}

		// Try extracting just the { … } portion and repairing that
		const braceMatch = text.match(/\{[\s\S]*/);
		if (braceMatch) {
			try {
				const repaired = untruncateJson(braceMatch[0]);
				JSON.parse(repaired);
				console.info('[ResumeGeneration] untruncate-json repaired brace-extracted JSON.');
				return repaired;
			} catch {
				// still broken
			}
		}

		return null;
	}

	/**
	 * Full extraction + repair pipeline for the fallback path.
	 * Returns parsed JSON or `null`.
	 */
	private extractAndRepairJson(raw: string): unknown | null {
		let text = this.stripWrappers(raw);

		// 1. Try parsing directly
		try {
			return JSON.parse(text);
		} catch {
			// needs work
		}

		// 2. Try untruncate-json on the full text
		try {
			const repaired = untruncateJson(text);
			return JSON.parse(repaired);
		} catch {
			// continue
		}

		// 3. Extract the first { … } block (greedy) and try
		const braceMatch = text.match(/\{[\s\S]*\}/);
		if (braceMatch) {
			try {
				return JSON.parse(braceMatch[0]);
			} catch {
				// ignore
			}
		}

		// 4. Extract from first { to end (for truncated output) and repair
		const braceStart = text.match(/\{[\s\S]*/);
		if (braceStart) {
			try {
				const repaired = untruncateJson(braceStart[0]);
				return JSON.parse(repaired);
			} catch {
				// truly unrecoverable
			}
		}

		return null;
	}

	/**
	 * Strip common LLM output wrappers:
	 * - `<think>…</think>` blocks from thinking models
	 * - Markdown fenced code blocks (```json … ```)
	 * - Leading/trailing whitespace
	 */
	private stripWrappers(raw: string): string {
		// Remove <think>…</think> blocks
		let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

		// Extract content from fenced code blocks
		const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
		if (fenced) {
			text = fenced[1].trim();
		}

		return text;
	}

	// ── Prompt ────────────────────────────────────────────────────

	/**
	 * Reads the prompt template from disk (once, then cached) and
	 * replaces `{resumeText}` / `{jobDescription}` placeholders.
	 */
	private buildPrompt(resumeText: string, jobDescription: string): string {
		if (!this.promptTemplate) {
			this.promptTemplate = this.loadPromptTemplate();
		}

		return this.promptTemplate
			.replace('{resumeText}', resumeText)
			.replace('{jobDescription}', jobDescription);
	}

	private loadPromptTemplate(): string {
		const candidates = [
			path.resolve(process.cwd(), 'src/lib/services/resume/defaultPrompt.txt'),
			path.resolve(__dirname, '../resume/defaultPrompt.txt')
		];

		for (const p of candidates) {
			try {
				return fs.readFileSync(p, 'utf8');
			} catch {
				// try next
			}
		}

		// Hard-coded fallback so the service never crashes on missing file.
		return [
			'You are a resume assistant. Given the following profile and job description,',
			'produce a structured JSON resume that highlights the most relevant experience.',
			'',
			'**Resume Text:** {resumeText}',
			'**Job Description:** {jobDescription}',
			'',
			'Return only valid JSON matching the provided schema.'
		].join('\n');
	}

	// ── Templating ────────────────────────────────────────────────

	/**
	 * Compiles the Handlebars template and renders the resume data
	 * into a Markdown string.
	 */
	private applyTemplate(template: ResumeTemplate, data: ResumeData): string {
		const compiled = Handlebars.compile(template.content);
		return compiled(data);
	}

	// ── Profile serialisation ─────────────────────────────────────

	/**
	 * Converts the structured profile into a human-readable plain-text
	 * block suitable for the LLM prompt.
	 */
	private profileToText(profile: ProfileData): string {
		const lines: string[] = [];

		const add = (label: string, key: string) => {
			const value = profile[key];
			if (!value) return;
			const text = Array.isArray(value) ? value.join(', ') : value;
			if (text.length > 0) {
				lines.push(`${label}: ${text}`);
			}
		};

		// Prefer the comprehensive description if available.
		if (profile['profile_description']) {
			const desc = Array.isArray(profile['profile_description'])
				? profile['profile_description'].join('\n')
				: profile['profile_description'];
			lines.push(desc);
			lines.push('');
		}

		add('Name', 'name');
		add('Email', 'email');
		add('Phone', 'phone');
		add('Location', 'location');
		add('LinkedIn', 'linkedin_url');
		add('Portfolio', 'portfolio_url');
		add('GitHub', 'github_url');
		add('Summary', 'resume_summary');
		add('Skills', 'skills');
		add('Years of Experience', 'years_of_experience');
		add('Experience', 'experience');
		add('Projects', 'projects');
		add('Education', 'education');
		add('Certifications', 'certifications');
		add('Languages', 'languages');

		// Include raw resume text when available (may contain extra detail).
		if (profile['resume_raw_text']) {
			const raw = Array.isArray(profile['resume_raw_text'])
				? profile['resume_raw_text'].join('\n')
				: profile['resume_raw_text'];
			if (raw.length > 0) {
				lines.push('');
				lines.push('--- Additional Resume Content ---');
				lines.push(raw);
			}
		}

		return lines.join('\n');
	}
}
