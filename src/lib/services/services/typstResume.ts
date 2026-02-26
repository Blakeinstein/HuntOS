import { generateObject, generateText, wrapLanguageModel, extractReasoningMiddleware } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { OPENROUTER_API_KEY } from '$env/static/private';
import type { ProfileService, ProfileData } from './profile';
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
	/** OpenRouter model identifier */
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

const DEFAULT_CONFIG: TypstResumeConfig = {
	model: 'qwen/qwen3-30b-a3b-instruct-2507',
	timeoutMs: 120_000,
	maxOutputTokens: 16_384,
	nnjrDir: path.resolve(process.cwd(), 'vendor/NNJR')
};

// ── Service ──────────────────────────────────────────────────────

/**
 * Generates resumes using the NNJR Typst template.
 *
 * Pipeline:
 * 1. Load the user profile and serialise it to plain text.
 * 2. Call the LLM to produce structured JSON matching the NNJR YAML shape.
 * 3. Convert the JSON to YAML.
 * 4. Write the YAML to a temp file alongside the NNJR template files.
 * 5. Run `typst compile` to produce a PDF.
 * 6. Return the PDF buffer and structured data.
 */
export class TypstResumeService {
	private profileService: ProfileService;
	private config: TypstResumeConfig;
	private openrouter: ReturnType<typeof createOpenRouter>;
	private promptTemplate: string | null = null;

	constructor(profileService: ProfileService, config?: Partial<TypstResumeConfig>) {
		this.profileService = profileService;
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.openrouter = createOpenRouter({ apiKey: OPENROUTER_API_KEY });
	}

	// ── Public API ────────────────────────────────────────────────

	/**
	 * Generate a tailored resume PDF using the NNJR Typst template.
	 *
	 * @param jobDescription  Full text of the target job posting.
	 */
	async generate(jobDescription: string): Promise<TypstResumeResult> {
		// 1. Load profile → plain text
		const profile = await this.profileService.getProfile();
		const resumeText = this.profileToText(profile);

		// 2. Build the LLM prompt
		const prompt = this.buildPrompt(resumeText, jobDescription);

		// 3. Call the LLM for structured JSON
		const data = await this.callLLM(prompt);

		// 4. Convert to YAML
		const yaml = this.toYaml(data);

		// 5. Compile with Typst → PDF
		const pdfBuffer = await this.compilePdf(yaml);

		return {
			pdfBuffer,
			data,
			yaml,
			templateName: 'NNJR Typst'
		};
	}

	// ── LLM ──────────────────────────────────────────────────────

	/**
	 * Calls the LLM to produce structured resume data matching the
	 * NNJR YAML schema. Uses the same layered strategy as the
	 * Markdown resume service: generateObject with repair, then
	 * generateText fallback.
	 */
	private async callLLM(prompt: string): Promise<TypstResumeData> {
		const baseModel = this.openrouter(this.config.model);

		const model = wrapLanguageModel({
			model: baseModel,
			middleware: [extractReasoningMiddleware({ tagName: 'think' })]
		});

		const sharedSettings = {
			maxOutputTokens: this.config.maxOutputTokens,
			abortSignal: AbortSignal.timeout(this.config.timeoutMs)
		};

		// ── Primary: generateObject ───────────────────────────────
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
					return this.repairJson(text);
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
		} catch (primaryError) {
			console.warn(
				'[TypstResume] generateObject failed, falling back to generateText:',
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
				'[TypstResume] generateText finished with reason "length" — output truncated.',
				'Tokens used:',
				usage
			);
		}

		const json = this.extractAndRepairJson(text);
		if (!json) {
			console.error(
				'[TypstResume] Could not extract JSON from LLM response.',
				`finishReason=${finishReason}`,
				'Raw text (first 2000 chars):',
				text.slice(0, 2000)
			);
			throw new Error(
				`Typst resume generation failed: the model did not return valid JSON (finishReason=${finishReason}).`
			);
		}

		const result = typstResumeDataSchema.safeParse(json);
		if (!result.success) {
			console.error(
				'[TypstResume] Extracted JSON did not match schema.',
				'Validation errors:',
				JSON.stringify(result.error.issues ?? result.error, null, 2)
			);
			throw new Error(
				`Typst resume generation failed: JSON did not match the expected schema (finishReason=${finishReason}).`
			);
		}

		return result.data;
	}

	// ── YAML serialisation ───────────────────────────────────────

	/**
	 * Convert the structured resume data to YAML matching the NNJR
	 * `example.yml` format. Uses a hand-rolled serialiser to avoid
	 * pulling in a YAML library — the structure is simple and flat.
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

		// Education
		lines.push('education:');
		for (const edu of data.education) {
			lines.push(`  - name: ${this.yamlString(edu.name)}`);
			lines.push(`    degree: ${this.yamlString(edu.degree)}`);
			lines.push(`    location: ${this.yamlString(edu.location ?? '')}`);
			lines.push(`    date: ${this.yamlString(edu.date)}`);
		}

		// Experience
		lines.push('experience:');
		for (const exp of data.experience) {
			lines.push(`  - role: ${this.yamlString(exp.role)}`);
			lines.push(`    name: ${this.yamlString(exp.name)}`);
			lines.push(`    location: ${this.yamlString(exp.location ?? '')}`);
			lines.push(`    date: ${this.yamlString(exp.date)}`);
			lines.push('    points:');
			for (const point of exp.points) {
				lines.push(`      - ${this.yamlString(point)}`);
			}
		}

		// Projects - Always include this key, even if empty
		lines.push('projects:');
		if (data.projects && data.projects.length > 0) {
			for (const proj of data.projects) {
				lines.push(`  - name: ${this.yamlString(proj.name)}`);
				lines.push(`    skills: ${this.yamlString(proj.skills)}`);
				lines.push(`    date: ${this.yamlString(proj.date)}`);
				lines.push('    points:');
				for (const point of proj.points) {
					lines.push(`      - ${this.yamlString(point)}`);
				}
			}
		}

		// Skills
		lines.push('skills:');
		for (const skill of data.skills) {
			lines.push(`  - category: ${this.yamlString(skill.category)}`);
			lines.push(`    skills: ${this.yamlString(skill.skills)}`);
		}

		return lines.join('\n') + '\n';
	}

	/**
	 * Quote a string for safe YAML output. Wraps in double quotes
	 * and escapes internal quotes and backslashes.
	 */
	private yamlString(value: string): string {
		if (value === '') return '""';
		// Always quote to avoid YAML parsing issues with colons, special chars, etc.
		const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
		return `"${escaped}"`;
	}

	// ── Typst compilation ────────────────────────────────────────

	/**
	 * Writes the YAML to a temp file inside the NNJR directory
	 * and runs `typst compile resume_yaml.typ` to produce a PDF.
	 *
	 * The temp files are cleaned up after compilation.
	 */
	async compilePdf(yaml: string): Promise<Buffer> {
		const nnjrDir = this.config.nnjrDir;

		// Verify the NNJR template files exist
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

		// Write YAML to a temp file in the NNJR directory
		// (resume_yaml.typ imports `yaml("example.yml")` — we overwrite it temporarily)
		const timestamp = Date.now();
		const yamlFilename = `_generated_${timestamp}.yml`;
		const yamlPath = path.join(nnjrDir, yamlFilename);

		// Create a temp .typ file that imports our yaml instead of example.yml
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
			// Write the temp files
			fs.writeFileSync(yamlPath, yaml, 'utf8');
			fs.writeFileSync(typEntryPath, typEntryContent, 'utf8');

			// Compile with Typst
			const { stderr } = await execFileAsync(
				'typst',
				['compile', typEntryFilename, path.basename(pdfPath)],
				{
					cwd: nnjrDir,
					timeout: 30_000
				}
			);

			if (stderr) {
				console.warn('[TypstResume] typst compile stderr:', stderr);
			}

			if (!fs.existsSync(pdfPath)) {
				throw new Error('typst compile did not produce a PDF file');
			}

			const pdfBuffer = fs.readFileSync(pdfPath);
			return pdfBuffer;
		} finally {
			// Clean up temp files
			this.safeUnlink(yamlPath);
			this.safeUnlink(typEntryPath);
			this.safeUnlink(pdfPath);
		}
	}

	// ── JSON repair helpers ──────────────────────────────────────

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

	// ── Prompt ────────────────────────────────────────────────────

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

		// Hard-coded fallback
		return [
			'You are a resume assistant. Given the following profile and job description,',
			'produce structured JSON matching the NNJR Typst resume template format.',
			'',
			'**Resume Text:** {resumeText}',
			'**Job Description:** {jobDescription}',
			'',
			'Return only valid JSON matching the provided schema.'
		].join('\n');
	}

	// ── Profile serialisation ─────────────────────────────────────

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
