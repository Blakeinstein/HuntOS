// src/lib/services/services/resumeAgent.ts
// Structured-output bridge to the Mastra `resume-agent`.
//
// Responsibility: given pre-serialised profile text and a job description,
// invoke the agent with the correct format instructions injected via
// RequestContext and return the typed structured data.
//
// Everything before this call (profile load, prompt assembly) and after it
// (template rendering, YAML serialisation, PDF compilation, history saving)
// is handled by the calling service — this class owns only the LLM step.

import type { Mastra } from '@mastra/core';
import { RequestContext } from '@mastra/core/request-context';
import { resumeDataSchema, type ResumeData } from '$lib/services/resume/schema';
import { typstResumeDataSchema, type TypstResumeData } from '$lib/services/resume/typstSchema';
import { promptRegistry } from '$lib/mastra/prompts/load';

// ── Public types ─────────────────────────────────────────────────

export type ResumeFormat = 'markdown' | 'typst';

export interface ResumeAgentInput {
	/** Pre-serialised plain-text representation of the candidate profile */
	profileText: string;
	/** Full text of the target job posting */
	jobDescription: string;
	/** Determines which schema and format instructions are injected */
	format: ResumeFormat;
}

// Discriminated union so callers get typed data back without casting
export type ResumeAgentOutput =
	| { format: 'markdown'; data: ResumeData }
	| { format: 'typst'; data: TypstResumeData };

// ── Service ──────────────────────────────────────────────────────

/**
 * Calls the Mastra `resume-agent` as a pure structured-output step.
 *
 * The agent has no tools. It receives the candidate profile and job
 * description in a single prompt and must return a JSON object that
 * matches the schema described in the format-specific context injected
 * at runtime. The calling service (ResumeGenerationService or
 * TypstResumeService) handles all pre- and post-processing.
 */
export class ResumeAgentService {
	private mastra: Mastra | null = null;

	/** Wire the Mastra instance after it has been initialised. */
	setMastra(mastra: Mastra): void {
		this.mastra = mastra;
	}

	get isReady(): boolean {
		return this.mastra !== null;
	}

	/**
	 * Run the resume agent for one generation.
	 *
	 * @throws If Mastra has not been wired.
	 * @throws If the agent response cannot be parsed against the expected schema.
	 */
	async generate(input: ResumeAgentInput): Promise<ResumeAgentOutput> {
		if (!this.mastra) {
			throw new Error('[ResumeAgentService] Mastra instance not wired. Call setMastra() first.');
		}

		const { profileText, jobDescription, format } = input;

		// Load the format-specific schema/output instructions from the prompt
		// registry and inject them as runtime context so the agent's dynamic
		// instructions function picks them up.
		const formatPromptId = `resume-agent.${format}`;
		const { content: formatInstructions } = promptRegistry.getPrompt({
			promptId: formatPromptId
		});

		const agent = this.mastra.getAgentById('resume-agent');

		const prompt = buildPrompt(profileText, jobDescription);

		// Inject format instructions via RequestContext so the agent's
		// dynamicContext function can read them from requestContext.get(…).
		const requestContext = new RequestContext([['format-instructions', formatInstructions]]);

		const agentResult = await agent.generate(prompt, {
			structuredOutput: {
				schema: format === 'markdown' ? resumeDataSchema : typstResumeDataSchema
			},
			requestContext
		});

		const raw = agentResult.object;

		if (format === 'markdown') {
			const parsed = resumeDataSchema.safeParse(raw);
			if (!parsed.success) {
				throw new Error(
					`[ResumeAgentService] Agent output did not match markdown schema: ` +
						JSON.stringify(parsed.error.issues, null, 2)
				);
			}
			return { format: 'markdown', data: parsed.data };
		} else {
			const parsed = typstResumeDataSchema.safeParse(raw);
			if (!parsed.success) {
				throw new Error(
					`[ResumeAgentService] Agent output did not match typst schema: ` +
						JSON.stringify(parsed.error.issues, null, 2)
				);
			}
			return { format: 'typst', data: parsed.data };
		}
	}
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Assemble the single-shot prompt sent to the agent.
 * The agent receives the profile and job description; format instructions
 * are injected separately via dynamic context so they stay decoupled.
 */
function buildPrompt(profileText: string, jobDescription: string): string {
	return [
		'## Candidate Profile',
		'',
		profileText.trim(),
		'',
		'## Job Description',
		'',
		jobDescription.trim()
	].join('\n');
}
