import { generateObject, generateText, wrapLanguageModel, extractReasoningMiddleware } from 'ai';
import { env } from '$env/dynamic/private';
import { resolveLanguageModel } from '$lib/mastra/providers';
import { logLLMError } from '$lib/services/helpers/formatLLMError';
import type { ProfileService } from './profile';
import type { ResumeAgentService } from './resumeAgent';
import { ResumeGenerationService } from './resumeGeneration';
import { typstResumeDataSchema, type TypstResumeData } from '../resume/typstSchema';
import untruncateJson from 'untruncate-json';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Types ────────────────────────────────────────────────────────

export interface TypstResumeConfig {
	/** Provider-qualified model string (e.g. "openrouter/qwen/qwen3-30b-a3b-instruct-2507") */
	model: string;
	/** Request timeout in milliseconds (default: 120_000) */
	timeoutMs: number;
	/** Maximum output tokens for the LLM (default: 16384) */
	maxOutputTokens: number;
	/** Path to the NNJR vendor directory */
	nnjrDir: string;
}

export interface TypstResumeResult {
	/** The generated PDF as a Buffer */
	pdfBuffer: Buffer;
	/** The structured JSON data returned by the LLM */
	data: TypstResumeData;
	/** The intermediate YAML content */
	yaml: string;
	/** Template name (always "NNJR Typst") */
	templateName: string;
}

function getDefaultConfig(): TypstResumeConfig {
	return {
		model:
			env.RESUME_SERVICE_MODEL ??
			env.DEFAULT_MODEL ??
			'openrouter/qwen/qwen3-30b-a3b-instruct-2507',
		timeoutMs: 120_000,
		maxOutputTokens: 16_384,
		nnjrDir: path.resolve(process.cwd(), 'vendor/NNJR')
	};
}

// ── Service ──────────────────────────────────────────────────────

/**
 * Generates resumes using the NNJR Typst template.
 *
 * Pipeline:
 * 1. Load the user profile and serialise it to plain text.
 * 2. Delegate the LLM step to ResumeAgentService when available
 *    (gives full Mastra Studio observability), otherwise call the
 *    LLM directly as a fallback.
 * 3. Convert the structured data to YAML.
 * 4. Compile the YAML with `typst compile` to produce a PDF.
 *
 * The agent service can be wired after construction via `setAgentService()`
 * to break the circular dependency between the service container and Mastra.
 */
export class TypstResumeService {
	private profileService: ProfileService;
	private agentService: ResumeAgentService | null = null;
	private config: TypstResumeConfig;
	private promptTemplate: string | null = null;

	constructor(profileService: ProfileService, config?: Partial<TypstResumeConfig>) {
		this.profileService = profileService;
		this.config = { ...getDefaultConfig(), ...config };
	}

	/** Wire the agent service after Mastra has initialised. */
	setAgentService(agentService: ResumeAgentService): void {
		this.agentService = agentService;
	}

	// ── Public API ────────────────────────────────────────────────

	/**
	 * Generate a tailored resume PDF using the NNJR Typst template.
	 *
	 * Uses the agent for the LLM step when available so every generation
	 * is traced in Mastra Studio. Falls back to a direct LLM call when
	 * the agent is not yet wired.
	 *
	 * @param jobDescription  Full text of the target job posting.
	 */
	async generate(jobDescription: string): Promise<TypstResumeResult> {
		const profile = await this.profileService.getProfile();
		const profileText = ResumeGenerationService.profileToText(profile);

		// ── LLM step (agent-preferred, direct fallback) ───────────
		let data: TypstResumeData;

		if (this.agentService?.isReady) {
			const output = await this.agentService.generate({
				profileText,
				jobDescription,
				format: 'typst'
			});
			data = output.format === 'typst' ? output.data : (output.data as unknown as TypstResumeData);
		} else {
			const prompt = this.buildPrompt(profileText, jobDescription);
			data = await this.callLLM(prompt);
		}

		// ── Post-processing ───────────────────────────────────────
		const yaml = this.toYaml(data);
		const pdfBuffer = await this.compilePdf(yaml);

		return { pdfBuffer, data, yaml, templateName: 'NNJR Typst' };
	}

	// ── YAML serialisation ───────────────────────────────────────

	/**
	 * Convert the structured resume data to YAML matching the NNJR
	 * `example.yml` format.
	 */
	toYaml(data: TypstResumeData): string {
		const lines: string[] = [];

		// Personal
		lines.push('personal:');
		lines.push(`  name: ${this.yamlString(data.personal.name)}`);
		lines.push(`  phone: ${this.yamlString(data.personal.phone ?? '')}`);
		lines.push(`  email: ${this.yamlString(data.personal.email)}`);
		lines.push(`  linkedin: ${this.yamlString(data.personal.linkedin ?? '')}`);
		lines.push(`  site: ${this.yamlString(data.personal.site ?? '')}`);
		lines.push('');

		// Education
		lines.push('education:');
		for (const edu of data.education) {
			lines.push(`  - name: ${this.yamlString(edu.name)}`);
			lines.push(`    degree: ${this.yamlString(edu.degree)}`);
			lines.push(`    location: ${this.yamlString(edu.location ?? '')}`);
			lines.push(`    date: ${this.yamlString(edu.date)}`);
		}
		lines.push('');

		// Experience
		lines.push('experience:');
		for (const exp of data.experience) {
			lines.push(`  - role: ${this.yamlString(exp.role)}`);
			lines.push(`    name: ${this.yamlString(exp.name)}`);
			lines.push(`    location: ${this.yamlString(exp.location ?? '')}`);
			lines.push(`    date: ${this.yamlString(exp.date)}`);
			lines.push(`    points:`);
			for (const point of exp.points) {
				lines.push(`      - ${this.yamlString(point)}`);
			}
		}
		lines.push('');

		// Projects (optional)
		if (data.projects && data.projects.length > 0) {
			lines.push('projects:');
			for (const proj of data.projects) {
				lines.push(`  - name: ${this.yamlString(proj.name)}`);
				lines.push(`    skills: ${this.yamlString(proj.skills)}`);
				lines.push(`    date: ${this.yamlString(proj.date)}`);
				lines.push(`    points:`);
				for (const point of proj.points) {
					lines.push(`      - ${this.yamlString(point)}`);
				}
			}
			lines.push('');
		}

		// Skills
		lines.push('skills:');
		for (const skill of data.skills) {
			lines.push(`  - category: ${this.yamlString(skill.category)}`);
			lines.push(`    skills: ${this.yamlString(skill.skills)}`);
		}

		return lines.join('\n');
	}

	private yamlString(value: string): string {
		if (value === '') return '""';
		const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
		return `"${escaped}"`;
	}

	// ── Typst compilation ────────────────────────────────────────

	/**
	 * Writes the YAML to a temp file inside the NNJR directory
	 * and runs `typst compile` to produce a PDF.
	 *
	 * The temp files are cleaned up after compilation.
	 */
	async compilePdf(yaml: string): Promise<Buffer> {
		const nnjrDir = this.config.nnjrDir;

		const requiredFiles = ['resume_yaml.typ', 'yml.typ', 'template.typ'];
		for (const file of requiredFiles) {
			const filePath = path.join(nnjrDir, file);
			if (!fs.existsSync(filePath)) {
				throw new Error(
					`NNJR template file missing: ${filePath}. ` +
						'Ensure the vendor/NNJR submodule is initialised.'
				);
			}
		}

		const timestamp = Date.now();
		const yamlFilename = `_generated_${timestamp}.yml`;
		const yamlPath = path.join(nnjrDir, yamlFilename);

		const typEntryFilename = `_generated_${timestamp}.typ`;
		const typEntryPath = path.join(nnjrDir, typEntryFilename);
		const typEntryContent = [
			'#import "yml.typ": yml_resume',
			'',
			`#let resume_data = yaml("${yamlFilename}")`,
			'#yml_resume(resume_data)'
		].join('\n');

		const pdfPath = path.join(nnjrDir, `_generated_${timestamp}.pdf`);

		try {
			fs.writeFileSync(yamlPath, yaml, 'utf8');
			fs.writeFileSync(typEntryPath, typEntryContent, 'utf8');

			const { stderr } = await execFileAsync(
				'typst',
				['compile', typEntryFilename, path.basename(pdfPath)],
				{ cwd: nnjrDir, timeout: 30_000 }
			);

			if (stderr) {
				console.warn('[TypstResume] typst compile stderr:', stderr);
			}

			if (!fs.existsSync(pdfPath)) {
				throw new Error('typst compile did not produce a PDF file');
			}

			return fs.readFileSync(pdfPath);
		} finally {
			this.safeUnlink(yamlPath);
			this.safeUnlink(typEntryPath);
			this.safeUnlink(pdfPath);
		}
	}

	// ── Direct LLM fallback ───────────────────────────────────────

	/**
	 * Calls the LLM directly to produce structured Typst resume data.
	 * Used only when the agent service is not yet available.
	 *
	 * Strategy:
	 * 1. generateObject with Zod schema (native structured output / json_schema).
	 *    Uses experimental_repairText with untruncate-json for truncated output.
	 * 2. generateText fallback — strips wrappers, repairs, validates manually.
	 */
	private async callLLM(prompt: string): Promise<TypstResumeData> {
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
				schema: typstResumeDataSchema,
				schemaName: 'TypstResume',
				schemaDescription:
					'Resume data for the NNJR Typst template. Contains personal info, education, experience, projects, and categorised skills.',
				prompt,
				...sharedSettings,
				experimental_repairText: async ({ text }) => {
					console.warn(
						'[TypstResume] repairText invoked — attempting repair…',
						'text length:',
						text.length
					);
					return this.repairJson(text) ?? text;
				}
			});

			if (result.finishReason === 'length') {
				console.warn(
					'[TypstResume] generateObject finished with reason "length" — output may be truncated.',
					'Tokens used:',
					result.usage
				);
			}

			return result.object;
		} catch (err) {
			primaryError = err;
			console.warn(
				'[TypstResume] generateObject failed, falling back to generateText:',
				err instanceof Error ? err.message : err
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
				'[TypstResume] generateText finished with reason "length" — output truncated.',
				'Tokens used:',
				usage
			);
		}

		const json = this.extractAndRepairJson(text);
		if (!json) {
			const { summary: primarySummary } = logLLMError(
				primaryError,
				'[TypstResume][generateObject]'
			);
			console.error(
				'[TypstResume][generateText fallback] Could not extract JSON from response.',
				`finishReason=${finishReason}`,
				'Raw text (first 2000 chars):\n',
				text.slice(0, 2000)
			);
			throw new Error(
				`Typst resume generation failed: model did not return parseable JSON ` +
					`(finishReason=${finishReason}). generateObject failure: ${primarySummary}`
			);
		}

		const result = typstResumeDataSchema.safeParse(json);
		if (!result.success) {
			const { summary: primarySummary } = logLLMError(
				primaryError,
				'[TypstResume][generateObject]'
			);
			console.error(
				'[TypstResume][generateText fallback] Extracted JSON did not match schema.',
				`finishReason=${finishReason}`,
				'Validation errors:\n',
				JSON.stringify(result.error.issues ?? result.error, null, 2),
				'\nExtracted JSON (first 2000 chars):\n',
				JSON.stringify(json).slice(0, 2000)
			);
			throw new Error(
				`Typst resume generation failed: JSON did not match the expected schema ` +
					`(finishReason=${finishReason}). generateObject failure: ${primarySummary}`
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
			return repaired;
		} catch {
			// continue
		}

		const braceMatch = text.match(/\{[\s\S]*/);
		if (braceMatch) {
			try {
				const repaired = untruncateJson(braceMatch[0]);
				JSON.parse(repaired);
				return repaired;
			} catch {
				// unrecoverable
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
				// unrecoverable
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

	// ── Prompt (fallback path only) ───────────────────────────────

	private buildPrompt(profileText: string, jobDescription: string): string {
		if (!this.promptTemplate) {
			this.promptTemplate = this.loadPromptTemplate();
		}
		return this.promptTemplate
			.replace('{resumeText}', profileText)
			.replace('{jobDescription}', jobDescription);
	}

	private loadPromptTemplate(): string {
		const candidates = [
			path.resolve(process.cwd(), 'src/lib/services/resume/typstPrompt.txt'),
			path.resolve(__dirname, '../resume/typstPrompt.txt')
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
			'produce structured JSON matching the required resume schema.',
			'',
			'**Resume Text:** {resumeText}',
			'**Job Description:** {jobDescription}',
			'',
			'Return only valid JSON matching the provided schema.'
		].join('\n');
	}

	// ── Utilities ─────────────────────────────────────────────────

	private safeUnlink(filePath: string): void {
		try {
			if (fs.existsSync(filePath)) {
				fs.unlinkSync(filePath);
			}
		} catch {
			// Swallow — temp file cleanup is best-effort
		}
	}
}
