// src/lib/services/services/resumeAgent.ts
// Structured-output bridge to the Mastra `resume-agent`.
//
// Responsibility: given pre-serialised profile text, a job description, and
// optionally a block of link-summary context, invoke the agent with the
// correct format instructions injected via RequestContext and return the
// typed structured data.
//
// Everything before this call (profile load, prompt assembly, link summary
// retrieval) and after it (template rendering, YAML serialisation, PDF
// compilation, history saving) is handled by the calling service — this
// class owns only the LLM step.

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
	/** Full text of the target job posting — injected into the system prompt via dynamic context */
	jobDescription: string;
	/** Determines which schema and format instructions are injected */
	format: ResumeFormat;
	/**
	 * Optional block of link-summary context (GitHub, LinkedIn, Portfolio, etc.)
	 * to append to the prompt so the agent has richer project/experience detail.
	 * Produced by LinkSummaryVectorService.getAllSummariesAsText() or a targeted
	 * semantic search. When omitted, the prompt contains only the base profile.
	 */
	linkSummariesContext?: string;
	/**
	 * The human-turn message that kicks off the generation.
	 * Defaults to a standard instruction to produce a tailored resume from the
	 * profile and job description already present in the system context.
	 */
	bootstrapMessage?: string;
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

		// Build the human-turn message. The JD lives in the system context (injected
		// below via RequestContext) so the human turn only needs the profile and the
		// bootstrap instruction to trigger completion.
		const humanMessage = buildHumanMessage(
			profileText,
			input.bootstrapMessage,
			input.linkSummariesContext
		);

		// Inject format instructions and the job description via RequestContext so
		// the agent's dynamicContext function can read them from requestContext.get(…).
		const requestContext = new RequestContext([
			['format-instructions', formatInstructions],
			['job-description', jobDescription]
		]);

		const agentResult = await agent.generate(humanMessage, {
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

/** Default bootstrap message used when no custom one is provided. */
export const DEFAULT_BOOTSTRAP_MESSAGE =
	'Please generate a tailored, ATS-friendly resume for the job description provided. ' +
	'Use the candidate profile and any link summaries to highlight the most relevant ' +
	'experience, skills, and accomplishments. Return only the structured output.';

/**
 * Assemble the human-turn message sent to the agent.
 *
 * The job description is now part of the system prompt (injected via
 * RequestContext / dynamicContext), so the human turn only needs:
 *   1. The candidate profile.
 *   2. Optional link-summary context.
 *   3. The bootstrap instruction that triggers structured output.
 */
function buildHumanMessage(
	profileText: string,
	bootstrapMessage?: string,
	linkSummariesContext?: string
): string {
	const parts: string[] = ['## Candidate Profile', '', profileText.trim()];

	if (linkSummariesContext && linkSummariesContext.trim().length > 0) {
		parts.push(
			'',
			'## Candidate Link Summaries',
			'',
			"The following are AI-generated summaries of the candidate's profile links " +
				'(GitHub, LinkedIn, Portfolio, etc.). Use these to find richer project details, ' +
				'open-source contributions, and accomplishments when tailoring the resume. ' +
				'Do not fabricate anything not present in the summaries below.',
			'',
			linkSummariesContext.trim()
		);
	}

	parts.push('', '---', '', bootstrapMessage?.trim() || DEFAULT_BOOTSTRAP_MESSAGE);

	return parts.join('\n');
}
