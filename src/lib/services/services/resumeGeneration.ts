import { generateObject } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import Handlebars from 'handlebars';
import { OPENROUTER_API_KEY } from '$env/static/private';
import type { ProfileService, ProfileData } from './profile';
import type { ResumeTemplateService, ResumeTemplate } from './resumeTemplate';
import { resumeDataSchema, type ResumeData } from '../resume/schema';
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
	timeoutMs: 120_000
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
	 * Calls the LLM via AI SDK's `generateObject` with a Zod schema,
	 * so the response is always well-typed and validated.
	 */
	private async callLLM(prompt: string): Promise<ResumeData> {
		const { object } = await generateObject({
			model: this.openrouter(this.config.model),
			schema: resumeDataSchema,
			prompt,
			abortSignal: AbortSignal.timeout(this.config.timeoutMs)
		});

		return object;
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
