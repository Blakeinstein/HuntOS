import { generateObject, generateText, wrapLanguageModel, extractReasoningMiddleware } from 'ai';
import { logLLMError } from '$lib/services/helpers/formatLLMError';
import Handlebars from 'handlebars';
import { env } from '$env/dynamic/private';
import { resolveLanguageModel } from '$lib/mastra/providers';
import type { ProfileService, ProfileData } from './profile';
import type { ResumeTemplateService, ResumeTemplate } from './resumeTemplate';
import type { ResumeAgentService } from './resumeAgent';
import type { LinkSummaryVectorService } from './linkSummaryVector';
import { resumeDataSchema, type ResumeData } from '../resume/schema';
import untruncateJson from 'untruncate-json';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Types ────────────────────────────────────────────────────────

export interface ResumeGenerationConfig {
	/** Provider-qualified model string (e.g. "openrouter/qwen/qwen3-30b-a3b-instruct-2507") */
	model: string;
	/** Request timeout in milliseconds (default: 120 000 — 2 minutes) */
	timeoutMs: number;
	/** Maximum output tokens for the LLM (default: 16384) */
	maxOutputTokens: number;
}

export interface ResumeGenerationResult {
	/** The final resume rendered as Markdown through the template */
	markdown: string;
	/** The structured JSON data returned by the LLM (before templating) */
	data: ResumeData;
	/** Which template was used */
	templateName: string;
}

function getDefaultConfig(): ResumeGenerationConfig {
	return {
		model:
			env.RESUME_SERVICE_MODEL ??
			env.DEFAULT_MODEL ??
			'openrouter/qwen/qwen3-30b-a3b-instruct-2507',
		timeoutMs: 120_000,
		maxOutputTokens: 16_384
	};
}

// ── Service ──────────────────────────────────────────────────────

/**
 * Orchestrates Markdown resume generation end-to-end:
 *
 * 1. Loads the user profile and serialises it to plain text.
 * 2. Delegates the LLM step to ResumeAgentService when available
 *    (gives full Mastra Studio observability), otherwise calls the
 *    LLM directly as a fallback.
 * 3. Renders the structured JSON through a Handlebars template into Markdown.
 *
 * The agent service can be wired after construction via `setAgentService()`
 * to break the circular dependency between the service container and Mastra.
 */
export class ResumeGenerationService {
	private profileService: ProfileService;
	private templateService: ResumeTemplateService;
	private agentService: ResumeAgentService | null = null;
	private linkSummaryVectorService: LinkSummaryVectorService | null = null;
	private config: ResumeGenerationConfig;
	private promptTemplate: string | null = null;

	constructor(
		profileService: ProfileService,
		templateService: ResumeTemplateService,
		config?: Partial<ResumeGenerationConfig>
	) {
		this.profileService = profileService;
		this.templateService = templateService;
		this.config = { ...getDefaultConfig(), ...config };
	}

	/** Wire the agent service after Mastra has initialised. */
	setAgentService(agentService: ResumeAgentService): void {
		this.agentService = agentService;
	}

	/** Wire the link summary vector service for RAG context injection. */
	setLinkSummaryVectorService(service: LinkSummaryVectorService): void {
		this.linkSummaryVectorService = service;
	}

	// ── Public API ────────────────────────────────────────────────

	/**
	 * Generate a tailored Markdown resume for a given job description.
	 *
	 * Uses the agent for the LLM step when available so every generation
	 * is traced in Mastra Studio.  Falls back to a direct LLM call when
	 * the agent is not yet wired.
	 *
	 * @param jobDescription  The full text of the target job posting.
	 * @param templateId      Optional template id. Falls back to the default.
	 */
	async generate(jobDescription: string, templateId?: number): Promise<ResumeGenerationResult> {
		const profile = await this.profileService.getProfile();
		const profileText = ResumeGenerationService.profileToText(profile);

		// Gather link-summary context from the vector store (if available)
		const linkSummariesContext = this.linkSummaryVectorService
			? this.linkSummaryVectorService.getAllSummariesAsText()
			: '';

		// ── LLM step (agent-preferred, direct fallback) ───────────
		let data: ResumeData;

		if (this.agentService?.isReady) {
			const output = await this.agentService.generate({
				profileText,
				jobDescription,
				format: 'markdown',
				linkSummariesContext: linkSummariesContext || undefined
			});
			// TypeScript narrows the discriminated union
			data = output.format === 'markdown' ? output.data : (output.data as unknown as ResumeData);
		} else {
			const prompt = this.buildPrompt(profileText, jobDescription);
			data = await this.callLLM(prompt);
		}

		// ── Template rendering ────────────────────────────────────
		const template = templateId
			? (this.templateService.getById(templateId) ?? this.templateService.getDefault())
			: this.templateService.getDefault();

		const markdown = this.applyTemplate(template, data);

		return { markdown, data, templateName: template.name };
	}

	// ── Prompt helpers (also used by TypstResumeService) ─────────

	buildPrompt(profileText: string, jobDescription: string): string {
		if (!this.promptTemplate) {
			this.promptTemplate = this.loadPromptTemplate();
		}
		return this.promptTemplate
			.replace('{resumeText}', profileText)
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

	/**
	 * Serialise a profile record to a plain-text block suitable for an LLM prompt.
	 * Exposed as a static so TypstResumeService can reuse it without duplication.
	 */
	static profileToText(profile: ProfileData): string {
		const lines: string[] = [];

		const add = (label: string, key: string) => {
			const value = profile[key];
			if (!value) return;
			const text = Array.isArray(value) ? value.join(', ') : value;
			if (text.length > 0) {
				lines.push(`${label}: ${text}`);
			}
		};

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

	// ── Direct LLM fallback ───────────────────────────────────────

	/**
	 * Calls the LLM directly to produce structured resume JSON.
	 * Used only when the agent service is not yet available.
	 *
	 * Strategy:
	 * 1. generateObject with Zod schema (native structured output / json_schema).
	 *    Uses experimental_repairText with untruncate-json for truncated output.
	 * 2. generateText fallback — strips wrappers, repairs, validates manually.
	 */
	private async callLLM(prompt: string): Promise<ResumeData> {
		const baseModel = resolveLanguageModel(this.config.model);

		const model = wrapLanguageModel({
			model: baseModel,
			middleware: [extractReasoningMiddleware({ tagName: 'think' })]
		});

		const sharedSettings = {
			maxOutputTokens: this.config.maxOutputTokens,
			abortSignal: AbortSignal.timeout(this.config.timeoutMs)
		};

		// ── Primary: generateObject ───────────────────────────────
		let primaryError: unknown;
		try {
			const result = await generateObject({
				model,
				schema: resumeDataSchema,
				schemaName: 'Resume',
				schemaDescription:
					'ATS-friendly resume with professional profile, skills, experience, education, certifications, projects, and additional info.',
				prompt,
				...sharedSettings,
				experimental_repairText: async ({ text }) => {
					console.warn(
						'[ResumeGeneration] repairText invoked. Attempting repair…',
						'text length:',
						text.length
					);
					return this.repairJson(text) ?? text;
				}
			});

			if (result.finishReason === 'length') {
				console.warn(
					'[ResumeGeneration] generateObject finished with reason "length" — output may be truncated.',
					'Tokens used:',
					result.usage
				);
			}

			return result.object;
		} catch (err) {
			primaryError = err;
			logLLMError(err, '[ResumeGeneration][generateObject]', {
				model: this.config.model,
				promptLength: prompt.length
			});
			console.warn('[ResumeGeneration] generateObject failed — falling back to generateText');
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

		const json = this.extractAndRepairJson(text);
		if (!json) {
			const { summary: primarySummary } = logLLMError(
				primaryError,
				'[ResumeGeneration][generateObject]'
			);
			console.error(
				'[ResumeGeneration][generateText fallback] Could not extract JSON from response.',
				`finishReason=${finishReason}`,
				'Raw text (first 2000 chars):\n',
				text.slice(0, 2000)
			);
			throw new Error(
				`Resume generation failed: model did not return parseable JSON ` +
					`(finishReason=${finishReason}). generateObject failure: ${primarySummary}. ` +
					'Try again or switch to a different model.'
			);
		}

		const result = resumeDataSchema.safeParse(json);
		if (!result.success) {
			const { summary: primarySummary } = logLLMError(
				primaryError,
				'[ResumeGeneration][generateObject]'
			);
			console.error(
				'[ResumeGeneration][generateText fallback] Extracted JSON did not match schema.',
				`finishReason=${finishReason}`,
				'Validation errors:\n',
				JSON.stringify(result.error.issues ?? result.error, null, 2),
				'\nExtracted JSON (first 2000 chars):\n',
				JSON.stringify(json).slice(0, 2000)
			);
			throw new Error(
				`Resume generation failed: JSON did not match the expected schema ` +
					`(finishReason=${finishReason}). generateObject failure: ${primarySummary}. ` +
					'Try again or switch to a different model.'
			);
		}

		return result.data;
	}

	// ── JSON repair helpers ───────────────────────────────────────

	private repairJson(raw: string): string | null {
		const text = this.stripWrappers(raw);

		try {
			JSON.parse(text);
			return text;
		} catch {
			// needs repair
		}

		try {
			const repaired = untruncateJson(text);
			JSON.parse(repaired);
			console.info(
				'[ResumeGeneration] untruncate-json successfully repaired truncated output.',
				`Original length: ${text.length}, repaired length: ${repaired.length}`
			);
			return repaired;
		} catch {
			// untruncate couldn't fix it
		}

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

	private extractAndRepairJson(raw: string): unknown | null {
		const text = this.stripWrappers(raw);

		try {
			return JSON.parse(text);
		} catch {
			// needs work
		}

		try {
			const repaired = untruncateJson(text);
			return JSON.parse(repaired);
		} catch {
			// continue
		}

		const braceMatch = text.match(/\{[\s\S]*\}/);
		if (braceMatch) {
			try {
				return JSON.parse(braceMatch[0]);
			} catch {
				// ignore
			}
		}

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

	private stripWrappers(raw: string): string {
		let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
		const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
		if (fenced) {
			text = fenced[1].trim();
		}
		return text;
	}

	// ── Templating ────────────────────────────────────────────────

	private applyTemplate(template: ResumeTemplate, data: ResumeData): string {
		const hbs = Handlebars.create();

		hbs.registerHelper(
			'hasKeys',
			function (this: unknown, obj: unknown, options: Handlebars.HelperOptions) {
				const result = obj && typeof obj === 'object' && Object.keys(obj).length > 0;
				if (typeof options.fn !== 'function') {
					return !!result;
				}
				return result ? options.fn(this) : options.inverse(this);
			}
		);

		hbs.registerHelper('join', function (_arr: unknown, sep: unknown) {
			const arr = Array.isArray(_arr) ? _arr : [];
			const separator = typeof sep === 'string' ? sep : ', ';
			return arr.join(separator);
		});

		const compiled = hbs.compile(template.content);
		return compiled(data);
	}
}
