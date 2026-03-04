// src/lib/services/services/applyPipelineExecutor.ts
// Orchestrates the 3-step apply pipeline: research → resume → apply.
//
// Each step is executed sequentially. Progress is persisted via the
// ApplicationPipelineService so the frontend can poll for updates.
// Audit logs are written at each step boundary for observability.
// Granular step logs are written within each step for detailed progress.
//
// Cancellation is cooperative: the executor checks the DB status at
// key checkpoints and throws a CancellationError to abort cleanly.
//
// On success the application is moved to "Applied".
// On job closed (no longer accepting applications) the application is moved to "Rejected".
// On other failures the application is moved to "Action Required".
// On cancel the application stays in "Backlog".
//
// Resume-from-step: When a pipeline fails the user can retry from the
// failed step instead of starting over. Previously completed steps are
// skipped and their outputs are reconstructed from saved resources.

import type { ApplicationService, ApplicationWithSwimlane } from './application';
import type { ApplicationPipelineService, PipelineStep } from './applicationPipeline';
import type { ApplicationResourceService } from './applicationResource';
import type { AuditLogService } from './auditLog';
import type { ProfileService } from './profile';
import type { ResumeGenerationService, ResumeGenerationResult } from './resumeGeneration';
import type { ResumeData } from '../resume/schema';
import type { ResumeHistoryService } from './resumeHistory';
import type { SwimlaneService } from './swimlane';
import type { BrowserAgentService } from './browserAgent';
import type { AppSettingsService } from './appSettings';
import type { TypstResumeService } from './typstResume';
import type { ResumeTemplateService } from './resumeTemplate';
import type { Mastra } from '@mastra/core';
import {
	applicationResultSchema,
	type ApplicationResult,
	type ApplicationField
} from '$lib/mastra/agents/job-application-agent/types';
import {
	runAgentContinuationLoop,
	type IterationInfo
} from '$lib/services/helpers/agentContinuationLoop';
import { resolveSiteInstructions } from '$lib/mastra/agents/job-application-agent/site-instructions';
import { RequestContext } from '@mastra/core/request-context';
import type { JobApplicationRequestContext } from '$lib/mastra/agents/job-application-agent/types';
import { logLLMError } from '$lib/services/helpers/formatLLMError';
import fs from 'fs';
import { PIPELINE_STEPS } from './applicationPipeline';
import { browserExec } from '$lib/mastra/tools/browser/exec';
import { search } from 'search-ai-core';
import path from 'path';
import {
	buildRunScreenshotDir,
	ensureRunScreenshotDir,
	captureIterationScreenshot
} from '$lib/services/helpers/screenshotRun';

// ── Types ───────────────────────────────────────────────────────────

export interface PipelineExecutionResult {
	success: boolean;
	pipelineRunId: number;
	error?: string;
}

export interface ApplyStepResult {
	success: boolean;
	submitted: boolean;
	blocked: boolean;
	blockedReason?: string | null;
	fieldsFilled: number;
	fieldsMissing: number;
	resumeUploaded: boolean;
	coverLetterProvided: boolean;
	formPagesVisited: number;
	fields: ApplicationField[];
	errors: string[];
	notes?: string | null;
	screenshotTaken: boolean;
}

export interface PipelineExecutionOptions {
	/**
	 * When set, skip all steps before this one and reconstruct their
	 * outputs from previously saved application resources.
	 *
	 * e.g. `resumeFrom: 'resume'` skips the research step and rebuilds
	 * the ResearchResult from the most recent job_description,
	 * company_info and role_research resources.
	 */
	resumeFrom?: PipelineStep;
}

interface ResearchResult {
	jobDescription: string;
	companyInfo: string;
	roleResearch: string;
}

// ── Cancellation ────────────────────────────────────────────────────

class CancellationError extends Error {
	constructor() {
		super('Pipeline cancelled by user');
		this.name = 'CancellationError';
	}
}

/**
 * Error thrown when the job application cannot proceed because:
 * - The job is no longer accepting applications (closed)
 * - You've already applied to this position (already_applied)
 *
 * This is a terminal state - the application should be moved to "Rejected"
 * rather than "Action Required" since there's nothing the user can do.
 */
class ApplicationClosedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ApplicationClosedError';
	}
}

// ── Executor ────────────────────────────────────────────────────────

/**
 * Executes the full apply pipeline for a single application.
 *
 * ## Pipeline Steps
 *
 * 1. **Research** — Navigate to the job posting page with browser tools,
 *    extract the job description, and run a quick web search for a
 *    company/role summary.
 *
 * 2. **Resume** — Using the job description + research from step 1 and the
 *    active user's profile, generate a tailored resume.
 *
 * 3. **Apply** — Navigate to the job posting URL with the browser agent
 *    and attempt to fill out and submit the application form.
 *
 * ## Resume-from-step
 *
 * When a pipeline fails and the user retries with `resumeFrom`, the
 * executor skips completed steps by reconstructing their outputs from
 * saved application resources. The new pipeline run marks those steps
 * as already completed.
 *
 * ## Cancellation
 *
 * The executor calls `checkCancelled()` at natural checkpoints within
 * each step. When the user cancels via the API, the pipeline_run status
 * is set to 'cancelled' in the DB. On the next checkpoint, the executor
 * detects this and throws a CancellationError, which is handled specially
 * (no swimlane move, clean audit trail).
 *
 * ## Step Logging
 *
 * Each step writes granular progress logs via `log()` that the frontend
 * polls and displays in real-time under each step in the progress panel.
 */
export class ApplyPipelineExecutor {
	private applicationService: ApplicationService;
	private pipelineService: ApplicationPipelineService;
	private resourceService: ApplicationResourceService;
	private auditLogService: AuditLogService;
	private profileService: ProfileService;
	private resumeGenerationService: ResumeGenerationService;
	private resumeHistoryService: ResumeHistoryService;
	private swimlaneService: SwimlaneService;
	private browserAgentService: BrowserAgentService;
	private appSettingsService: AppSettingsService;
	private typstResumeService: TypstResumeService;
	private resumeTemplateService: ResumeTemplateService;
	private mastra: Mastra | null = null;

	constructor(deps: {
		applicationService: ApplicationService;
		pipelineService: ApplicationPipelineService;
		resourceService: ApplicationResourceService;
		auditLogService: AuditLogService;
		profileService: ProfileService;
		resumeGenerationService: ResumeGenerationService;
		resumeHistoryService: ResumeHistoryService;
		swimlaneService: SwimlaneService;
		browserAgentService: BrowserAgentService;
		appSettingsService: AppSettingsService;
		typstResumeService: TypstResumeService;
		resumeTemplateService: ResumeTemplateService;
	}) {
		this.applicationService = deps.applicationService;
		this.pipelineService = deps.pipelineService;
		this.resourceService = deps.resourceService;
		this.auditLogService = deps.auditLogService;
		this.profileService = deps.profileService;
		this.resumeGenerationService = deps.resumeGenerationService;
		this.resumeHistoryService = deps.resumeHistoryService;
		this.swimlaneService = deps.swimlaneService;
		this.browserAgentService = deps.browserAgentService;
		this.appSettingsService = deps.appSettingsService;
		this.typstResumeService = deps.typstResumeService;
		this.resumeTemplateService = deps.resumeTemplateService;
	}

	/**
	 * Wire the Mastra instance after construction.
	 *
	 * When set, the executor uses `mastra.getAgent('job-application-agent')`
	 * to retrieve the registered agent — this ensures observability, tracing,
	 * and telemetry are wired in and LLM invocations appear in Mastra Studio.
	 */
	setMastra(mastra: Mastra): void {
		this.mastra = mastra;
	}

	// ── Helpers ─────────────────────────────────────────────────────

	/**
	 * Write a progress log for the current step. These logs are polled
	 * by the frontend and displayed under each step in real-time.
	 */
	private log(
		runId: number,
		step: PipelineStep,
		message: string,
		level: 'info' | 'warn' | 'error' | 'progress' = 'info',
		meta?: Record<string, unknown>
	): void {
		this.pipelineService.addStepLog(runId, step, level, message, meta);
	}

	/**
	 * Check if the pipeline has been cancelled. Call this at natural
	 * checkpoints within each step so cancellation is responsive.
	 */
	private checkCancelled(runId: number): void {
		if (this.pipelineService.isCancelled(runId)) {
			throw new CancellationError();
		}
	}

	/**
	 * Find a swimlane ID by its name.
	 */
	private async findSwimlaneByName(name: string): Promise<number | null> {
		const swimlanes = await this.swimlaneService.getSwimlanes();
		const match = swimlanes.find((s) => s.name.toLowerCase() === name.toLowerCase());
		return match?.id ?? null;
	}

	/**
	 * Basic HTML tag stripping for extracting text content.
	 */
	private stripHtml(html: string): string {
		return html
			.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
			.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
			.replace(/<[^>]+>/g, ' ')
			.replace(/&nbsp;/g, ' ')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 50_000);
	}

	/**
	 * Determine whether a step should be skipped based on `resumeFrom`.
	 *
	 * @returns `true` if the step comes before the resumeFrom step and
	 * should be skipped (its output will be reconstructed from resources).
	 */
	private shouldSkipStep(step: PipelineStep, resumeFrom?: PipelineStep): boolean {
		if (!resumeFrom) return false;
		const stepIndex = PIPELINE_STEPS.indexOf(step);
		const resumeIndex = PIPELINE_STEPS.indexOf(resumeFrom);
		return stepIndex < resumeIndex;
	}

	// ── Resource Reconstruction ────────────────────────────────────

	/**
	 * Rebuild a `ResearchResult` from previously saved application resources.
	 * Used when resuming from a step after research.
	 */
	private reconstructResearchResult(runId: number, applicationId: number): ResearchResult {
		this.log(runId, 'research', 'Reconstructing research from saved resources…', 'progress');

		const jobDescResources = this.resourceService.getByApplicationId(
			applicationId,
			'job_description'
		);
		const companyResources = this.resourceService.getByApplicationId(applicationId, 'company_info');
		const roleResources = this.resourceService.getByApplicationId(applicationId, 'role_research');

		const jobDescription = jobDescResources[0]?.content ?? '';
		const companyInfo = companyResources[0]?.content ?? '';
		const roleResearch = roleResources[0]?.content ?? '';

		if (!jobDescription) {
			this.log(
				runId,
				'research',
				'Warning: no saved job description found — using empty string',
				'warn'
			);
		}

		this.log(
			runId,
			'research',
			`Reconstructed research: ${jobDescription.length} chars job desc, ${companyInfo.length} chars company, ${roleResearch.length} chars role`,
			'progress'
		);

		return { jobDescription, companyInfo, roleResearch };
	}

	/**
	 * Rebuild a `ResumeGenerationResult` from previously saved application resources.
	 * Used when resuming from the apply step (research + resume already done).
	 */
	private reconstructResumeResult(runId: number, applicationId: number): ResumeGenerationResult {
		this.log(runId, 'resume', 'Reconstructing resume from saved resources…', 'progress');

		const resumeResources = this.resourceService.getByApplicationId(applicationId, 'resume');
		const latestResume = resumeResources[0];

		if (!latestResume) {
			throw new Error(
				'Cannot resume from apply step: no previously generated resume found. ' +
					'Try resuming from the resume step instead.'
			);
		}

		const templateName = (latestResume.meta?.templateName as string) ?? 'unknown';

		// Reconstruct a minimal data object.
		// This is a best-effort reconstruction — the apply step only
		// needs the markdown content, not the structured data.
		const data = {
			name: '',
			professional_profile: '',
			skills: [] as string[],
			experience: [],
			education: [],
			certifications: [],
			projects: [],
			additional_info: {}
		} satisfies ResumeData;

		this.log(
			runId,
			'resume',
			`Reconstructed resume: ${latestResume.content.length} chars, template: ${templateName}`,
			'progress'
		);

		return {
			markdown: latestResume.content,
			data,
			templateName
		};
	}

	// ── Browser-based page fetching ────────────────────────────────

	/**
	 * Use the browser tools to navigate to a URL and extract text content.
	 * Falls back to a plain HTTP fetch + stripHtml if the browser is unavailable.
	 */
	private async fetchPageWithBrowser(
		runId: number,
		url: string
	): Promise<{ text: string; usedBrowser: boolean }> {
		// Try browser-based extraction first
		try {
			this.log(runId, 'research', `Opening ${url} in browser…`, 'progress');

			const openResult = await browserExec(['open', url], { timeout: 20_000 });
			if (!openResult.success) {
				this.log(runId, 'research', `Browser open failed: ${openResult.stderr}`, 'warn');
				throw new Error(openResult.stderr);
			}

			this.checkCancelled(runId);

			// Wait a moment for dynamic content
			await browserExec(['wait', '2000'], { timeout: 10_000 });

			this.checkCancelled(runId);

			// Extract main content text via JS evaluation
			this.log(runId, 'research', 'Extracting page content via browser…', 'progress');
			const textResult = await browserExec(
				[
					'eval',
					`(() => {
						const selectors = [
							'[role="main"]', 'main', 'article',
							'.job-description', '.job-details', '.posting-page',
							'#job-description', '#content', '.content'
						];
						for (const sel of selectors) {
							const el = document.querySelector(sel);
							if (el && el.innerText.trim().length > 100) return el.innerText.trim();
						}
						return document.body.innerText.trim();
					})()`
				],
				{ timeout: 15_000 }
			);

			if (textResult.success && textResult.stdout.trim().length > 50) {
				const text = textResult.stdout.trim().slice(0, 50_000);
				this.log(runId, 'research', `Extracted ${text.length} characters via browser`, 'progress');
				return { text, usedBrowser: true };
			}

			this.log(
				runId,
				'research',
				'Browser extraction returned insufficient content, falling back to HTTP fetch',
				'warn'
			);
		} catch (browserError) {
			if (browserError instanceof CancellationError) throw browserError;
			const msg = browserError instanceof Error ? browserError.message : String(browserError);
			this.log(
				runId,
				'research',
				`Browser extraction failed: ${msg} — falling back to HTTP fetch`,
				'warn'
			);
		}

		// Fallback: plain HTTP fetch
		return this.fetchPageWithHttp(runId, url);
	}

	/**
	 * Fallback HTTP fetch + HTML stripping.
	 */
	private async fetchPageWithHttp(
		runId: number,
		url: string
	): Promise<{ text: string; usedBrowser: boolean }> {
		this.log(runId, 'research', `Fetching ${url} via HTTP…`, 'progress');

		try {
			const response = await fetch(url, {
				headers: {
					'User-Agent':
						'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
				},
				signal: AbortSignal.timeout(15_000)
			});

			if (response.ok) {
				const html = await response.text();
				const text = this.stripHtml(html);
				this.log(runId, 'research', `Fetched via HTTP: ${text.length} characters`, 'progress');
				return { text, usedBrowser: false };
			}

			this.log(runId, 'research', `HTTP fetch returned ${response.status}`, 'warn');
		} catch (fetchError) {
			if (fetchError instanceof CancellationError) throw fetchError;
			const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
			this.log(runId, 'research', `HTTP fetch failed: ${msg}`, 'warn');
		}

		return { text: '', usedBrowser: false };
	}

	/**
	 * Run two parallel web searches (company overview + role-specific) via
	 * search-ai-core and merge the results into a single markdown summary.
	 */
	private async webSearchSummary(runId: number, company: string, title: string): Promise<string> {
		const companyQuery = company;
		const roleQuery = `${title} at ${company}`;

		try {
			this.log(
				runId,
				'research',
				`Searching web for "${companyQuery}" and "${roleQuery}"…`,
				'progress'
			);

			this.checkCancelled(runId);

			const [companyResults, roleResults] = await Promise.all([
				search({ query: companyQuery, count: 3 }),
				search({ query: roleQuery, count: 3 })
			]);

			this.checkCancelled(runId);

			const markdownOpts = {
				extend: true,
				contentLength: 2000,
				ignoreImages: true,
				ignoreLinks: true
			} as const;

			const [companyMd, roleMd] = await Promise.all([
				companyResults?.length ? companyResults.markdown(markdownOpts) : '',
				roleResults?.length ? roleResults.markdown(markdownOpts) : ''
			]);

			this.checkCancelled(runId);

			const sections: string[] = [];
			if (companyMd.trim()) {
				sections.push(`## Company: ${company}\n\n${companyMd.trim()}`);
			}
			if (roleMd.trim()) {
				sections.push(`## Role: ${title} at ${company}\n\n${roleMd.trim()}`);
			}

			if (sections.length === 0) {
				this.log(runId, 'research', 'Web search returned no useful content', 'warn');
				return '';
			}

			const summary = sections.join('\n\n---\n\n').slice(0, 8000);
			const totalResults = (companyResults?.length ?? 0) + (roleResults?.length ?? 0);
			this.log(
				runId,
				'research',
				`Web search returned ${summary.length} characters from ${totalResults} results across 2 queries`,
				'progress'
			);
			return summary;
		} catch (error) {
			if (error instanceof CancellationError) throw error;
			const msg = error instanceof Error ? error.message : String(error);
			this.log(runId, 'research', `Web search failed: ${msg}`, 'warn');
		}

		return '';
	}

	// ── Public API ─────────────────────────────────────────────────

	/**
	 * Execute the full pipeline for the given application.
	 *
	 * Creates the pipeline run internally. If the caller needs the run ID
	 * immediately (e.g. to return it in an HTTP response before the async
	 * work completes), use {@link executeWithRun} instead.
	 *
	 * @param applicationId - The application to process.
	 * @param options - Optional execution options (e.g. `resumeFrom`).
	 */
	async execute(
		applicationId: number,
		options: PipelineExecutionOptions = {}
	): Promise<PipelineExecutionResult> {
		const { resumeFrom } = options;

		// 1. Validate the application
		const application = await this.applicationService.getApplication(applicationId);
		if (!application) {
			return { success: false, pipelineRunId: -1, error: 'Application not found' };
		}

		const swimlane = application.swimlane_name.toLowerCase();
		if (swimlane !== 'backlog' && swimlane !== 'action required') {
			return {
				success: false,
				pipelineRunId: -1,
				error: `Application must be in Backlog or Action Required to apply (current: ${application.swimlane_name})`
			};
		}

		if (this.pipelineService.hasActiveRun(applicationId)) {
			return {
				success: false,
				pipelineRunId: -1,
				error: 'A pipeline is already running for this application'
			};
		}

		// Validate resumeFrom step
		if (resumeFrom && !PIPELINE_STEPS.includes(resumeFrom)) {
			return {
				success: false,
				pipelineRunId: -1,
				error: `Invalid resumeFrom step: "${resumeFrom}". Valid steps: ${PIPELINE_STEPS.join(', ')}`
			};
		}

		// 2. Create the pipeline run
		const run = this.pipelineService.create(applicationId);

		// If resuming, pre-mark earlier steps as completed
		if (resumeFrom) {
			for (const step of PIPELINE_STEPS) {
				if (step === resumeFrom) break;
				this.pipelineService.completeStep(run.id, step);
				this.log(run.id, step, `Skipped (resuming from ${resumeFrom})`, 'progress');
			}
		}

		// 3. Delegate to the shared execution logic
		return this.runPipeline(run.id, applicationId, options);
	}

	/**
	 * Execute the pipeline using a **pre-created** pipeline run.
	 *
	 * This is the preferred entry point from HTTP handlers that need to
	 * return the `pipelineRunId` immediately. The caller creates the run
	 * row (synchronous SQLite write) and then fires this method without
	 * awaiting it:
	 *
	 * ```ts
	 * const run = pipelineService.create(applicationId);
	 * executor.executeWithRun(applicationId, run.id, { resumeFrom }).catch(…);
	 * return json({ pipelineRunId: run.id });
	 * ```
	 *
	 * @param applicationId - The application to process.
	 * @param runId - An already-created pipeline run ID.
	 * @param options - Optional execution options (e.g. `resumeFrom`).
	 */
	async executeWithRun(
		applicationId: number,
		runId: number,
		options: PipelineExecutionOptions = {}
	): Promise<PipelineExecutionResult> {
		return this.runPipeline(runId, applicationId, options);
	}

	// ── Core pipeline logic ────────────────────────────────────────

	/**
	 * Shared implementation that both `execute()` and `executeWithRun()`
	 * delegate to. Assumes the pipeline run row already exists.
	 */
	private async runPipeline(
		runId: number,
		applicationId: number,
		options: PipelineExecutionOptions = {}
	): Promise<PipelineExecutionResult> {
		const { resumeFrom } = options;

		const application = await this.applicationService.getApplication(applicationId);
		if (!application) {
			this.pipelineService.fail(runId, 'Application not found');
			return { success: false, pipelineRunId: runId, error: 'Application not found' };
		}

		const pipelineTitle = resumeFrom
			? `Apply pipeline resumed from ${resumeFrom}: ${application.company} — ${application.title}`
			: `Apply pipeline started: ${application.company} — ${application.title}`;

		const finishAudit = this.auditLogService.start({
			category: 'application',
			agent_id: 'apply-pipeline',
			title: pipelineTitle,
			meta: { applicationId, pipelineRunId: runId, resumeFrom: resumeFrom ?? null }
		});

		try {
			// ── Step 1: Research ─────────────────────────────────────
			let research: ResearchResult;

			if (this.shouldSkipStep('research', resumeFrom)) {
				research = this.reconstructResearchResult(runId, applicationId);
				this.log(runId, 'research', 'Research step skipped — using saved resources', 'progress');
			} else {
				this.log(runId, 'research', 'Starting research step…');
				research = await this.executeResearchStep(runId, application);
			}

			this.checkCancelled(runId);

			// ── Step 2: Resume ──────────────────────────────────────
			let resumeResult: ResumeGenerationResult;

			if (this.shouldSkipStep('resume', resumeFrom)) {
				research = this.reconstructResearchResult(runId, applicationId);
				resumeResult = this.reconstructResumeResult(runId, applicationId);
				this.log(runId, 'resume', 'Resume step skipped — using saved resources', 'progress');
			} else {
				this.log(runId, 'resume', 'Starting resume generation…');
				resumeResult = await this.executeResumeStep(runId, application, research);
			}

			this.checkCancelled(runId);

			// ── Step 3: Apply ───────────────────────────────────────
			this.log(runId, 'apply', 'Starting application submission…');
			await this.executeApplyStep(runId, application, resumeResult);

			// Mark pipeline as complete
			this.pipelineService.complete(runId);
			this.log(runId, 'apply', 'Pipeline completed successfully', 'progress');

			// Move to Applied
			const appliedSwimlane = await this.findSwimlaneByName('Applied');
			if (appliedSwimlane) {
				await this.applicationService.moveApplication(
					applicationId,
					appliedSwimlane,
					'Auto-apply pipeline completed successfully',
					'system'
				);
			}

			finishAudit({
				status: 'success',
				detail: `Pipeline completed for ${application.company} — ${application.title}`,
				meta: { applicationId, pipelineRunId: runId }
			});

			return { success: true, pipelineRunId: runId };
		} catch (error) {
			// ── Cancellation ────────────────────────────────────────
			if (error instanceof CancellationError) {
				this.log(
					runId,
					this.pipelineService.getById(runId)?.current_step ?? 'research',
					'Pipeline cancelled by user',
					'warn'
				);

				finishAudit({
					status: 'warning',
					detail: `Pipeline cancelled for ${application.company}`,
					meta: { applicationId, pipelineRunId: runId, cancelled: true }
				});

				return { success: false, pipelineRunId: runId, error: 'Cancelled by user' };
			}

			// ── Job no longer accepting applications ────────────────
			if (error instanceof ApplicationClosedError) {
				const message = error.message;
				const currentStep = this.pipelineService.getById(runId)?.current_step ?? 'apply';

				this.log(runId, currentStep, `Application closed: ${message}`, 'warn');

				// Log as a resource for auditability
				this.resourceService.create({
					applicationId,
					resourceType: 'error',
					title: 'Application Closed - No Further Action Possible',
					content: message,
					meta: {
						pipelineRunId: runId,
						step: currentStep,
						closedReason: message
					}
				});

				// Move to Rejected swimlane
				const rejectedSwimlane = await this.findSwimlaneByName('Rejected');
				if (rejectedSwimlane) {
					await this.applicationService.moveApplication(
						applicationId,
						rejectedSwimlane,
						`Application closed: ${message}`,
						'system'
					);
				}

				finishAudit({
					status: 'warning',
					detail: `Application closed for ${application.company}: ${message}`,
					meta: { applicationId, pipelineRunId: runId, closed: true }
				});

				return { success: false, pipelineRunId: runId, error: message };
			}

			// ── Failure ─────────────────────────────────────────────
			const message = error instanceof Error ? error.message : String(error);
			const currentStep = this.pipelineService.getById(runId)?.current_step ?? 'research';

			this.pipelineService.fail(runId, message);
			this.log(runId, currentStep, `Pipeline failed: ${message}`, 'error');

			// Log error as a resource
			this.resourceService.create({
				applicationId,
				resourceType: 'error',
				title: 'Pipeline Error',
				content: message,
				meta: {
					pipelineRunId: runId,
					step: currentStep
				}
			});

			// Move to Action Required
			const actionRequiredSwimlane = await this.findSwimlaneByName('Action Required');
			if (actionRequiredSwimlane) {
				await this.applicationService.moveApplication(
					applicationId,
					actionRequiredSwimlane,
					`Apply pipeline failed: ${message}`,
					'system'
				);
			}

			finishAudit({
				status: 'error',
				detail: `Pipeline failed for ${application.company}: ${message}`,
				meta: { applicationId, pipelineRunId: runId, error: message }
			});

			return { success: false, pipelineRunId: runId, error: message };
		}
	}

	// ── Step Executors ──────────────────────────────────────────────

	/**
	 * Step 1: Research — navigate to the job posting with the browser,
	 * extract the description, and run a web search for supplemental info.
	 */
	private async executeResearchStep(
		runId: number,
		application: ApplicationWithSwimlane
	): Promise<ResearchResult> {
		const step: PipelineStep = 'research';
		this.pipelineService.startStep(runId, step);

		const finishStepAudit = this.auditLogService.start({
			category: 'application',
			agent_id: 'apply-pipeline.research',
			title: `Researching: ${application.company} — ${application.title}`,
			meta: { applicationId: application.id, step }
		});

		try {
			let jobDescription = application.job_description ?? '';

			// ── Fetch job posting via browser (with HTTP fallback) ──
			if (!jobDescription && application.job_description_url) {
				const { text, usedBrowser } = await this.fetchPageWithBrowser(
					runId,
					application.job_description_url
				);

				this.checkCancelled(runId);

				if (text) {
					jobDescription = text;
					this.log(
						runId,
						step,
						`Fetched job posting (${usedBrowser ? 'browser' : 'HTTP'}): ${jobDescription.length} characters`,
						'progress'
					);
				} else {
					this.log(
						runId,
						step,
						'Could not fetch job posting — both browser and HTTP failed',
						'warn'
					);
				}
			} else if (jobDescription) {
				this.log(
					runId,
					step,
					`Using existing job description (${jobDescription.length} chars)`,
					'progress'
				);
			}

			this.checkCancelled(runId);

			if (!jobDescription) {
				jobDescription = `${application.title} at ${application.company}`;
				this.log(
					runId,
					step,
					'No job description available, using title + company as fallback',
					'warn'
				);
			}

			// Save the job description as a resource
			this.log(runId, step, 'Saving job description…', 'progress');
			this.resourceService.create({
				applicationId: application.id,
				resourceType: 'job_description',
				title: 'Job Description',
				content: jobDescription,
				meta: { url: application.job_description_url }
			});

			this.checkCancelled(runId);

			// ── Web search for supplemental research ────────────────
			let webSearchSummary = '';
			try {
				webSearchSummary = await this.webSearchSummary(
					runId,
					application.company,
					application.title
				);
			} catch (searchError) {
				if (searchError instanceof CancellationError) throw searchError;
				const msg = searchError instanceof Error ? searchError.message : String(searchError);
				this.log(runId, step, `Web search error: ${msg}`, 'warn');
			}

			this.checkCancelled(runId);

			// ── Build company info ──────────────────────────────────
			this.log(runId, step, `Compiling company research: ${application.company}`, 'progress');
			const companyInfoParts = [
				`Company: ${application.company}`,
				`Job Title: ${application.title}`,
				`Posting URL: ${application.job_description_url ?? 'N/A'}`
			];

			if (webSearchSummary) {
				companyInfoParts.push('', '--- Web Search Results ---', webSearchSummary);
			}

			const companyInfo = companyInfoParts.join('\n');

			this.resourceService.create({
				applicationId: application.id,
				resourceType: 'company_info',
				title: `Company Research: ${application.company}`,
				content: companyInfo,
				meta: {
					company: application.company,
					hasWebSearchSummary: !!webSearchSummary
				}
			});

			this.checkCancelled(runId);

			// ── Build role research ─────────────────────────────────
			this.log(runId, step, `Analyzing role: ${application.title}`, 'progress');
			const roleResearch = [
				`Role: ${application.title}`,
				`Company: ${application.company}`,
				'',
				'Key Details:',
				jobDescription.slice(0, 2000)
			].join('\n');

			this.resourceService.create({
				applicationId: application.id,
				resourceType: 'role_research',
				title: `Role Analysis: ${application.title}`,
				content: roleResearch,
				meta: { title: application.title, company: application.company }
			});

			// Update the application's job_description if we fetched a new one
			if (!application.job_description && jobDescription) {
				this.resourceService.create({
					applicationId: application.id,
					resourceType: 'job_description',
					title: 'Fetched Job Description',
					content: jobDescription
				});
			}

			// Save the web search summary as its own resource
			if (webSearchSummary) {
				this.resourceService.create({
					applicationId: application.id,
					resourceType: 'company_info',
					title: `Web Search: ${application.company} ${application.title}`,
					content: webSearchSummary,
					meta: {
						source: 'web-search',
						query: `${application.company} ${application.title} job`
					}
				});
			}

			this.pipelineService.completeStep(runId, step);
			this.log(runId, step, 'Research step completed', 'progress');

			finishStepAudit({
				status: 'success',
				detail: `Research completed for ${application.company}: ${jobDescription.length} chars of job description gathered${webSearchSummary ? `, ${webSearchSummary.length} chars from web search` : ''}`,
				meta: {
					jobDescriptionLength: jobDescription.length,
					webSearchSummaryLength: webSearchSummary.length
				}
			});

			return { jobDescription, companyInfo, roleResearch };
		} catch (error) {
			if (error instanceof CancellationError) throw error;

			const message = error instanceof Error ? error.message : String(error);
			this.log(runId, step, `Research failed: ${message}`, 'error');
			finishStepAudit({
				status: 'error',
				detail: `Research failed: ${message}`
			});
			throw new Error(`Research step failed: ${message}`);
		}
	}

	/**
	 * Step 2: Resume — generate a tailored resume using the user's profile
	 * and the job description from step 1.
	 */
	// ── Resume step ──────────────────────────────────────────────

	private async executeResumeStep(
		runId: number,
		application: ApplicationWithSwimlane,
		research: ResearchResult
	): Promise<ResumeGenerationResult> {
		const step: PipelineStep = 'resume';
		this.pipelineService.startStep(runId, step);

		const finishStepAudit = this.auditLogService.start({
			category: 'resume',
			agent_id: 'apply-pipeline.resume',
			title: `Generating resume for: ${application.company} — ${application.title}`,
			meta: { applicationId: application.id, step }
		});

		try {
			this.log(runId, step, 'Preparing enriched job description…', 'progress');

			const enrichedDescription = [
				research.jobDescription,
				'',
				'--- Company Research ---',
				research.companyInfo,
				'',
				'--- Role Analysis ---',
				research.roleResearch
			].join('\n');

			this.checkCancelled(runId);

			this.log(runId, step, 'Loading user profile…', 'progress');
			const profile = await this.profileService.getProfile();
			const profileKeys = Object.keys(profile);
			this.log(runId, step, `Profile loaded with ${profileKeys.length} fields`, 'progress');

			this.checkCancelled(runId);

			// Read the user's configured resume format
			const resumeFormat = this.appSettingsService.resumeFormat;
			this.log(runId, step, `Using resume format: ${resumeFormat}`, 'progress');

			const resumeName = this.resumeHistoryService.getNextResumeName(
				application.company,
				application.title
			);
			this.log(runId, step, `Resume name: ${resumeName}`, 'progress');

			let result: ResumeGenerationResult;
			const generationStartTime = Date.now();

			if (resumeFormat === 'typst') {
				// ── Typst pipeline ───────────────────────────────────
				this.log(runId, step, 'Generating tailored resume (Typst)…', 'progress', {
					descriptionLength: enrichedDescription.length
				});

				const typstResult = await this.typstResumeService.generate(enrichedDescription);
				const generationDurationMs = Date.now() - generationStartTime;

				this.checkCancelled(runId);

				this.log(
					runId,
					step,
					`Typst resume generated: ${typstResult.yaml.length} chars YAML, template: ${typstResult.templateName}`,
					'progress'
				);

				this.log(runId, step, 'Saving to resume history…', 'progress');
				const historyEntry = this.resumeHistoryService.create({
					name: resumeName,
					jobDescription: research.jobDescription,
					templateName: typstResult.templateName,
					model: 'resume-agent',
					data: typstResult.data as unknown as ResumeData,
					markdown: typstResult.yaml,
					durationMs: generationDurationMs,
					applicationId: application.id
				});

				try {
					this.resumeHistoryService.persistTypstPdf(historyEntry.id, typstResult.pdfBuffer);
					this.log(runId, step, 'Typst PDF persisted to history', 'progress');
				} catch (pdfErr) {
					const pdfMsg = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
					this.log(runId, step, `Typst PDF persist warning: ${pdfMsg}`, 'warn');
				}

				result = {
					markdown: typstResult.yaml,
					data: typstResult.data as unknown as ResumeData,
					templateName: typstResult.templateName
				};
			} else {
				// ── Markdown pipeline ─────────────────────────────────
				const template = this.resumeTemplateService.getDefault();

				this.log(
					runId,
					step,
					`Generating tailored resume (Markdown, template: ${template.name})…`,
					'progress',
					{ descriptionLength: enrichedDescription.length }
				);

				result = await this.resumeGenerationService.generate(enrichedDescription, template.id);
				const generationDurationMs = Date.now() - generationStartTime;

				this.checkCancelled(runId);

				this.log(
					runId,
					step,
					`Resume generated: ${result.markdown.length} chars, template: ${result.templateName}`,
					'progress'
				);

				this.log(runId, step, 'Saving to resume history…', 'progress');
				this.resumeHistoryService.create({
					name: resumeName,
					jobDescription: research.jobDescription,
					templateId: template.id,
					templateName: result.templateName,
					model: 'resume-agent',
					data: result.data,
					markdown: result.markdown,
					durationMs: generationDurationMs,
					applicationId: application.id
				});
			}

			this.checkCancelled(runId);

			// Save resume as a resource on the application
			this.log(runId, step, 'Saving resume as application resource…', 'progress');
			this.resourceService.create({
				applicationId: application.id,
				resourceType: 'resume',
				title: `Generated Resume: ${result.templateName}`,
				content: result.markdown,
				meta: {
					templateName: result.templateName,
					resumeFormat,
					resumeName,
					sections: Object.keys(result.data)
				}
			});

			this.pipelineService.completeStep(runId, step);
			this.log(runId, step, 'Resume step completed', 'progress');

			finishStepAudit({
				status: 'success',
				detail: `Resume generated for ${application.company}: ${result.markdown.length} chars (${resumeFormat})`,
				meta: {
					templateName: result.templateName,
					markdownLength: result.markdown.length,
					resumeFormat,
					resumeName
				}
			});

			return result;
		} catch (error) {
			if (error instanceof CancellationError) throw error;

			// Log full AI SDK error chain to server stdout before reducing to a
			// short message — the pipeline UI log only shows error.message which
			// loses the JSONParseError cause, raw model text, finishReason, etc.
			const { summary } = logLLMError(error, '[Pipeline][resume]', {
				applicationId: application.id,
				company: application.company,
				title: application.title,
				model: this.appSettingsService.resumeFormat
			});

			const message = error instanceof Error ? error.message : String(error);
			this.log(runId, step, `Resume generation failed: ${message}`, 'error');
			this.log(runId, step, `Server detail: ${summary}`, 'error');
			finishStepAudit({
				status: 'error',
				detail: `Resume generation failed: ${summary}`
			});
			throw new Error(`Resume step failed: ${message}`);
		}
	}

	/**
	 * Step 3: Apply — navigate to the job posting and use the Mastra
	 * job-application agent to fill out and submit the application form.
	 *
	 * A single unified agent handles all sites. Site-specific instructions
	 * are resolved from the URL at runtime and injected via RequestContext
	 * as dynamic context. The agent receives the user profile, job
	 * description, resume data, resume PDF path, and site-specific
	 * instructions, then uses browser tools to navigate and fill the
	 * form autonomously.
	 */
	private async executeApplyStep(
		runId: number,
		application: ApplicationWithSwimlane,
		resumeResult: ResumeGenerationResult
	): Promise<ApplyStepResult> {
		const step: PipelineStep = 'apply';
		this.pipelineService.startStep(runId, step);

		const finishStepAudit = this.auditLogService.start({
			category: 'browser',
			agent_id: 'apply-pipeline.apply',
			title: `Applying to: ${application.company} — ${application.title}`,
			meta: { applicationId: application.id, step, resumeTemplate: resumeResult.templateName }
		});

		try {
			if (!application.job_description_url) {
				this.log(runId, step, 'No job posting URL available — cannot auto-apply', 'error');
				throw new Error('No job posting URL available — cannot auto-apply');
			}

			this.checkCancelled(runId);

			const url = application.job_description_url;

			// ── Resolve site-specific instructions for this URL ──────
			const { site, instructions: siteInstructions } = resolveSiteInstructions(url);
			this.log(runId, step, `Detected application site: ${site}`, 'progress');

			this.auditLogService.create({
				category: 'agent',
				agent_id: 'job-application-agent',
				status: 'success',
				title: `Detected site: ${site}`,
				detail: `URL: ${url} → Site: ${site}`,
				meta: { applicationId: application.id, url, site }
			});

			// Retrieve the Mastra-registered agent so observability / tracing is
			// wired in and LLM invocations appear in Mastra Studio.
			if (!this.mastra) {
				throw new Error(
					'Mastra instance not wired — call setMastra() ' +
						'via the service container withMastra() lifecycle hook before running the pipeline.'
				);
			}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const agent = (this.mastra as any).getAgent('job-application-agent');

			// ── Build the request context ────────────────────────────
			this.log(runId, step, 'Preparing application context…', 'progress');

			const profile = await this.profileService.getProfile();
			const userProfileJson = JSON.stringify(profile);
			const resumeDataJson = JSON.stringify(resumeResult.data);
			const jobDescription = application.job_description ?? '';

			// Resolve the resume PDF path (if available from the history entry)
			let resumeFilePath = '';
			const historyEntry = this.resumeHistoryService.getByApplicationId(application.id);
			if (historyEntry?.pdf_path) {
				const absolutePdf = path.join(process.cwd(), historyEntry.pdf_path);
				if (fs.existsSync(absolutePdf)) {
					resumeFilePath = absolutePdf;
					this.log(runId, step, `Resume PDF available: ${historyEntry.pdf_path}`, 'progress');
				} else {
					this.log(runId, step, 'Resume PDF file not found on disk — skipping upload', 'warn');
				}
			} else {
				this.log(runId, step, 'No resume PDF available — skipping upload', 'progress');
			}

			const requestContext = new RequestContext<JobApplicationRequestContext>();
			requestContext.set('application-url', url);
			requestContext.set('user-profile', userProfileJson);
			requestContext.set('job-description', jobDescription);
			requestContext.set('resume-data', resumeDataJson);
			requestContext.set('resume-file-path', resumeFilePath);
			requestContext.set('detected-site', site);
			requestContext.set('site-instructions', siteInstructions);

			this.checkCancelled(runId);

			// ── Set up per-run screenshot directory ──────────────────
			const screenshotRunDir = buildRunScreenshotDir(runId, application.company, application.title);
			ensureRunScreenshotDir(screenshotRunDir);
			this.log(runId, step, `Screenshot dir: ${screenshotRunDir}`, 'progress');

			// ── Run the agent ────────────────────────────────────────
			this.log(runId, step, `Launching application agent (${site}) on: ${url}`, 'progress');

			const agentStartAudit = this.auditLogService.start({
				category: 'agent',
				agent_id: 'job-application-agent',
				title: `Application agent started: ${site} → ${application.company}`,
				meta: {
					applicationId: application.id,
					pipelineRunId: runId,
					url,
					site,
					agentId: 'job-application-agent',
					hasResumePdf: !!resumeFilePath,
					screenshotDir: screenshotRunDir
				}
			});

			const userMessage =
				`IMPORTANT: Your FIRST action MUST be to call browser-open to navigate to the Application URL. ` +
				`Do NOT return any result without first navigating to the page and taking a snapshot. ` +
				`The browser session may already be logged in — do NOT assume the page is blocked. ` +
				`Navigate to the application URL, inspect the actual page, then fill out and submit the job application form. ` +
				`The job is "${application.title}" at "${application.company}".`;

			let appResult: ApplicationResult;

			try {
				// Use the continuation loop: if the agent stops mid-task without
				// producing a JSON result, the loop feeds the conversation history
				// back with a continuation prompt so it can pick up where it left off.
				const loopResult = await runAgentContinuationLoop({
					agent,
					initialMessage: userMessage,
					requestContext,
					schema: applicationResultSchema,
					maxStepsPerIteration: 30,
					totalStepBudget: 80,
					maxIterations: 5,
					onBeforeIteration: (iteration, totalStepsSoFar) => {
						this.checkCancelled(runId);
						this.log(
							runId,
							step,
							iteration === 1
								? `Starting application agent (budget: 80 steps)…`
								: `Continuing agent — iteration ${iteration} (${totalStepsSoFar} steps used so far)…`,
							'progress'
						);
					},
					onIterationComplete: async (info: IterationInfo) => {
						// Summary line
						this.log(
							runId,
							step,
							`Iteration ${info.iteration}: ${info.stepsThisIteration} steps, ` +
								`${info.toolCallsThisIteration} tool calls, ` +
								`text=${info.textLength} chars` +
								(info.foundJson
									? info.schemaValid
										? ' ✓ valid JSON result'
										: ' ✗ JSON found but schema invalid'
									: ' — no JSON output yet') +
								(info.wasFinalAttempt ? ' (final attempt)' : ''),
							info.schemaValid ? 'progress' : 'warn'
						);

						// Agent's natural-language commentary (where it is / what it's doing)
						if (info.agentText) {
							this.log(runId, step, `Agent status: ${info.agentText}`, 'progress');
						}

						// Model reasoning / chain-of-thought (if the model supports it)
						if (info.reasoningText) {
							this.log(runId, step, `Agent reasoning: ${info.reasoningText}`, 'progress');
						}

						// ── Per-iteration annotated screenshot ───────
						// Captured outside the agent so it always runs even when the
						// agent gets stuck or produces no output.
						await captureIterationScreenshot(screenshotRunDir, info.iteration, 'after');
						this.log(
							runId,
							step,
							`Screenshot saved: iter-${String(info.iteration).padStart(2, '0')}-after.png`,
							'progress'
						);
					}
				});

				this.log(
					runId,
					step,
					`Agent loop completed: ${loopResult.iterations} iteration(s), ` +
						`${loopResult.totalSteps} total steps, ` +
						`${loopResult.totalToolCalls} total tool calls`,
					'progress'
				);

				// ── Final screenshot after loop completes ────────────
				await captureIterationScreenshot(screenshotRunDir, loopResult.iterations, 'final');
				this.log(runId, step, `Final screenshot saved: final.png`, 'progress');

				if (loopResult.result) {
					appResult = loopResult.result;
				} else {
					// All iterations exhausted without a valid structured result
					const detail = loopResult.validationError
						? `Agent JSON failed schema validation after ${loopResult.iterations} iteration(s): ${loopResult.validationError}`
						: `Agent produced no parseable JSON after ${loopResult.iterations} iteration(s). ` +
							`Last text: ${loopResult.lastText}`;

					agentStartAudit({
						status: 'error',
						detail,
						meta: {
							iterations: loopResult.iterations,
							totalSteps: loopResult.totalSteps,
							totalToolCalls: loopResult.totalToolCalls,
							validationError: loopResult.validationError,
							textPreview: loopResult.lastText
						}
					});
					throw new Error(detail);
				}
			} catch (error) {
				if (error instanceof CancellationError) throw error;

				const errMsg = error instanceof Error ? error.message : String(error);
				this.log(runId, step, `Agent execution failed: ${errMsg}`, 'warn');

				// Last resort: try to extract JSON from error details
				const extracted = this.tryExtractApplicationResult(error);
				if (!extracted) {
					agentStartAudit({
						status: 'error',
						detail: `Agent failed: ${errMsg}`,
						meta: { error: errMsg }
					});
					throw error;
				}

				appResult = extracted;

				this.log(
					runId,
					step,
					`Successfully extracted structured result from error details`,
					'progress'
				);
			}

			agentStartAudit({
				status: appResult.blocked ? 'warning' : appResult.success ? 'success' : 'error',
				detail: `Agent completed: success=${appResult.success}, submitted=${appResult.submitted}, blocked=${appResult.blocked}, fields_filled=${appResult.fields_filled}`,
				meta: {
					success: appResult.success,
					submitted: appResult.submitted,
					blocked: appResult.blocked,
					fieldsFilled: appResult.fields_filled,
					fieldsMissing: appResult.fields_missing,
					errors: appResult.errors,
					screenshotDir: screenshotRunDir
				}
			});

			this.checkCancelled(runId);

			this.log(
				runId,
				step,
				`Agent completed: success=${appResult.success}, submitted=${appResult.submitted}, ` +
					`fields_filled=${appResult.fields_filled}, fields_missing=${appResult.fields_missing}, ` +
					`blocked=${appResult.blocked}`,
				'progress'
			);

			// ── Log individual fields with their values ──────────────
			const filledFields = appResult.fields.filter((f) => f.status === 'filled');
			const missingFields = appResult.fields.filter(
				(f) => f.status === 'missing' || f.status === 'error'
			);

			if (filledFields.length > 0) {
				for (const field of filledFields) {
					this.log(
						runId,
						step,
						`Filled "${field.field_name}": ${field.value_used ?? '(set)'}`,
						'progress'
					);
				}

				this.log(runId, step, `Filled ${filledFields.length} form fields total`, 'progress', {
					fields: filledFields.map((f) => ({
						name: f.field_name,
						type: f.field_type,
						selector: f.selector,
						value: f.value_used
					}))
				});

				// Persist filled fields to the application record
				const fieldEntries: Record<string, string> = {};
				for (const field of filledFields) {
					fieldEntries[field.field_name] = field.value_used ?? '';
				}
				await this.applicationService.updateApplicationFields(application.id, fieldEntries);

				// Save completed fields as a resource for auditability
				this.resourceService.create({
					applicationId: application.id,
					resourceType: 'form_fields',
					title: 'Completed Form Fields',
					content: filledFields
						.map((f) => `${f.field_name} (${f.field_type}): ${f.value_used ?? '(set)'}`)
						.join('\n'),
					meta: {
						completedFields: filledFields.map((f) => ({
							name: f.field_name,
							type: f.field_type,
							selector: f.selector,
							value: f.value_used
						}))
					}
				});
			}

			this.checkCancelled(runId);

			// ── Log missing / errored fields ─────────────────────────
			if (missingFields.length > 0) {
				this.log(runId, step, `${missingFields.length} field(s) could not be filled`, 'warn', {
					missingFields: missingFields.map((f) => f.field_name)
				});

				this.resourceService.create({
					applicationId: application.id,
					resourceType: 'error',
					title: 'Missing / Errored Form Fields',
					content: missingFields
						.map(
							(f) =>
								`${f.field_name} (${f.field_type}) — ` +
								`${f.is_required ? 'required' : 'optional'}: ` +
								`${f.error_reason ?? f.status}`
						)
						.join('\n'),
					meta: { missingFields }
				});
			}

			// ── Log blocked state ────────────────────────────────────
			if (appResult.blocked) {
				this.log(
					runId,
					step,
					`Application blocked: ${appResult.blocked_reason ?? 'Unknown reason'}`,
					'error'
				);

				this.resourceService.create({
					applicationId: application.id,
					resourceType: 'error',
					title: 'Application Blocked',
					content: appResult.blocked_reason ?? 'The application was blocked',
					meta: { blocked: true, blockedReason: appResult.blocked_reason }
				});
			}

			// ── Log errors from the agent ────────────────────────────
			if (appResult.errors.length > 0) {
				const errorSummary = appResult.errors.join('\n');
				this.log(
					runId,
					step,
					`Application agent encountered ${appResult.errors.length} error(s)`,
					'warn',
					{ errors: appResult.errors }
				);

				this.resourceService.create({
					applicationId: application.id,
					resourceType: 'error',
					title: 'Application Errors',
					content: errorSummary,
					meta: { errors: appResult.errors }
				});
			}

			// ── Log notes ────────────────────────────────────────────
			if (appResult.notes) {
				this.log(runId, step, `Agent notes: ${appResult.notes}`, 'progress');
			}

			// ── Determine outcome based on end_reason from LLM ───────
			const succeeded = appResult.success && appResult.submitted && !appResult.blocked;
			const endReason = appResult.end_reason;

			// Handle job closed (no longer accepting applications)
			if (endReason === 'closed') {
				const closedReason =
					appResult.end_reason_description ?? 'The job is no longer accepting applications';
				throw new ApplicationClosedError(closedReason);
			}

			// Handle already applied
			if (endReason === 'already_applied') {
				const alreadyAppliedReason =
					appResult.end_reason_description ?? 'You have already applied to this position';
				throw new ApplicationClosedError(alreadyAppliedReason);
			}

			if (!succeeded && !appResult.blocked && appResult.errors.length > 0) {
				throw new Error(`Application agent failed: ${appResult.errors.join('; ')}`);
			}

			if (appResult.blocked) {
				throw new Error(`Application blocked: ${appResult.blocked_reason ?? 'Unknown reason'}`);
			}

			// Close browser session
			this.log(runId, step, 'Closing browser…', 'progress');
			try {
				await browserExec(['close']);
			} catch {
				/* best-effort */
			}

			this.pipelineService.completeStep(runId, step);

			const resultSummary = succeeded
				? `Application submitted to ${application.company}: ${appResult.fields_filled} fields filled`
				: `Application attempted with ${appResult.fields_missing} missing fields`;

			this.log(runId, step, resultSummary, 'progress');

			finishStepAudit({
				status: succeeded ? 'success' : 'warning',
				detail: resultSummary,
				meta: {
					agentId: 'job-application-agent',
					site,
					success: appResult.success,
					submitted: appResult.submitted,
					blocked: appResult.blocked,
					fieldsFilled: appResult.fields_filled,
					fieldsMissing: appResult.fields_missing,
					resumeUploaded: appResult.resume_uploaded,
					coverLetterProvided: appResult.cover_letter_provided,
					formPagesVisited: appResult.form_pages_visited,
					errors: appResult.errors
				}
			});

			return {
				success: appResult.success,
				submitted: appResult.submitted,
				blocked: appResult.blocked,
				blockedReason: appResult.blocked_reason,
				fieldsFilled: appResult.fields_filled,
				fieldsMissing: appResult.fields_missing,
				resumeUploaded: appResult.resume_uploaded,
				coverLetterProvided: appResult.cover_letter_provided,
				formPagesVisited: appResult.form_pages_visited,
				fields: appResult.fields,
				errors: appResult.errors,
				notes: appResult.notes,
				screenshotTaken: appResult.screenshot_taken
			};
		} catch (error) {
			if (error instanceof CancellationError) {
				// Best-effort browser cleanup on cancel
				try {
					await browserExec(['close']);
				} catch {
					/* ignore */
				}
				throw error;
			}

			// Ensure browser is closed on failure
			try {
				await browserExec(['close']);
			} catch {
				/* ignore */
			}

			const message = error instanceof Error ? error.message : String(error);
			this.log(runId, step, `Apply step failed: ${message}`, 'error');
			finishStepAudit({
				status: 'error',
				detail: `Apply step failed: ${message}`
			});
			throw new Error(`Apply step failed: ${message}`);
		}
	}

	// ── Helpers ──────────────────────────────────────────────────────

	/**
	 * Last-resort attempt to extract an ApplicationResult from an error
	 * that contains the agent's raw text response.
	 *
	 * Some models return valid JSON but wrapped in an array `[{...}]` or
	 * embedded in markdown code blocks. This method tries common patterns.
	 */
	private tryExtractApplicationResult(error: unknown): ApplicationResult | null {
		try {
			// Check if the error has a details.value property with the raw JSON
			const errAny = error as Record<string, unknown>;
			const details = errAny?.details as Record<string, unknown> | undefined;
			let rawValue = details?.value as string | undefined;

			// Also check the error cause chain
			if (!rawValue && error instanceof Error) {
				const cause = (error as { cause?: { details?: { value?: string } } }).cause;
				rawValue = cause?.details?.value;
			}

			if (!rawValue) return null;

			let parsed: unknown;
			try {
				parsed = JSON.parse(rawValue);
			} catch {
				// Try to extract JSON from markdown code blocks
				const jsonMatch = rawValue.match(/```(?:json)?\s*([\s\S]*?)```/);
				if (jsonMatch) {
					parsed = JSON.parse(jsonMatch[1].trim());
				} else {
					return null;
				}
			}

			// If the model returned an array, take the first element
			if (Array.isArray(parsed) && parsed.length > 0) {
				parsed = parsed[0];
			}

			// Validate against the schema
			const result = applicationResultSchema.safeParse(parsed);
			if (result.success) {
				return result.data;
			}

			return null;
		} catch {
			return null;
		}
	}
}
