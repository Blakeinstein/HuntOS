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
// On failure the application is moved to "Action Required".
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
import type { BrowserAgentService, BrowserAutomationResult } from './browserAgent';
import type { AppSettingsService } from './appSettings';
import type { TypstResumeService } from './typstResume';
import type { ResumeTemplateService } from './resumeTemplate';
import { PIPELINE_STEPS } from './applicationPipeline';
import { browserExec } from '$lib/mastra/tools/browser/exec';

// ── Types ───────────────────────────────────────────────────────────

export interface PipelineExecutionResult {
	success: boolean;
	pipelineRunId: number;
	error?: string;
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

// ── Executor ────────────────────────────────────────────────────────

/**
 * Executes the full apply pipeline for a single application.
 *
 * ## Pipeline Steps
 *
 * 1. **Research** — Navigate to the job posting page with browser tools,
 *    extract the job description, and run a quick Google search for a
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
	 * Run a Google search for the company + job title and extract a
	 * quick summary from the search results snippet text. Uses the
	 * browser tools to navigate to Google and read the results.
	 */
	private async googleSearchSummary(
		runId: number,
		company: string,
		title: string
	): Promise<string> {
		const query = `${company} ${title} job`;
		const encodedQuery = encodeURIComponent(query);
		const searchUrl = `https://www.google.com/search?q=${encodedQuery}`;

		try {
			this.log(runId, 'research', `Searching Google for "${query}"…`, 'progress');

			const openResult = await browserExec(['open', searchUrl], { timeout: 15_000 });
			if (!openResult.success) {
				this.log(
					runId,
					'research',
					`Google search navigation failed: ${openResult.stderr}`,
					'warn'
				);
				return '';
			}

			this.checkCancelled(runId);

			// Wait for search results to load
			await browserExec(['wait', '2000'], { timeout: 10_000 });

			this.checkCancelled(runId);

			// Extract search result snippets
			this.log(runId, 'research', 'Extracting Google search result snippets…', 'progress');
			const snippetResult = await browserExec(
				[
					'eval',
					`(() => {
						const snippets = [];
						// Standard Google search result containers
						const resultBlocks = document.querySelectorAll('#search .g, #rso .g');
						for (const block of Array.from(resultBlocks).slice(0, 5)) {
							const titleEl = block.querySelector('h3');
							const snippetEl = block.querySelector('[data-sncf], .VwiC3b, [style*="-webkit-line-clamp"], span:not(cite):not(h3)');
							const linkEl = block.querySelector('a[href]');
							const t = titleEl?.innerText?.trim() ?? '';
							const s = snippetEl?.innerText?.trim() ?? '';
							const u = linkEl?.getAttribute('href') ?? '';
							if (t || s) snippets.push(t + '\\n' + s + (u ? '\\nURL: ' + u : ''));
						}
						if (snippets.length === 0) {
							// Fallback: grab any visible text from search results area
							const searchDiv = document.querySelector('#search, #rso');
							if (searchDiv) return searchDiv.innerText.trim().slice(0, 3000);
							return '';
						}
						return snippets.join('\\n\\n---\\n\\n');
					})()`
				],
				{ timeout: 15_000 }
			);

			if (snippetResult.success && snippetResult.stdout.trim().length > 20) {
				const summary = snippetResult.stdout.trim().slice(0, 5000);
				this.log(
					runId,
					'research',
					`Google search returned ${summary.length} characters of snippets`,
					'progress'
				);
				return summary;
			}

			this.log(runId, 'research', 'Google search returned no useful snippets', 'warn');
		} catch (error) {
			if (error instanceof CancellationError) throw error;
			const msg = error instanceof Error ? error.message : String(error);
			this.log(runId, 'research', `Google search failed: ${msg}`, 'warn');
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
	 * extract the description, and run a Google search for supplemental info.
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

			// ── Google search for supplemental research ─────────────
			let googleSummary = '';
			try {
				googleSummary = await this.googleSearchSummary(
					runId,
					application.company,
					application.title
				);
			} catch (googleError) {
				if (googleError instanceof CancellationError) throw googleError;
				const msg = googleError instanceof Error ? googleError.message : String(googleError);
				this.log(runId, step, `Google search error: ${msg}`, 'warn');
			}

			this.checkCancelled(runId);

			// ── Build company info ──────────────────────────────────
			this.log(runId, step, `Compiling company research: ${application.company}`, 'progress');
			const companyInfoParts = [
				`Company: ${application.company}`,
				`Job Title: ${application.title}`,
				`Posting URL: ${application.job_description_url ?? 'N/A'}`
			];

			if (googleSummary) {
				companyInfoParts.push('', '--- Google Search Results ---', googleSummary);
			}

			const companyInfo = companyInfoParts.join('\n');

			this.resourceService.create({
				applicationId: application.id,
				resourceType: 'company_info',
				title: `Company Research: ${application.company}`,
				content: companyInfo,
				meta: {
					company: application.company,
					hasGoogleSummary: !!googleSummary
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

			// Save the Google search summary as its own resource
			if (googleSummary) {
				this.resourceService.create({
					applicationId: application.id,
					resourceType: 'company_info',
					title: `Google Search: ${application.company} ${application.title}`,
					content: googleSummary,
					meta: {
						source: 'google-search',
						query: `${application.company} ${application.title} job`
					}
				});
			}

			this.pipelineService.completeStep(runId, step);
			this.log(runId, step, 'Research step completed', 'progress');

			finishStepAudit({
				status: 'success',
				detail: `Research completed for ${application.company}: ${jobDescription.length} chars of job description gathered${googleSummary ? `, ${googleSummary.length} chars from Google` : ''}`,
				meta: {
					jobDescriptionLength: jobDescription.length,
					googleSummaryLength: googleSummary.length
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
				this.log(runId, step, 'Generating tailored resume via LLM (Typst)…', 'progress', {
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

				// Save to resume history (YAML as "markdown" content, PDF persisted separately)
				this.log(runId, step, 'Saving to resume history…', 'progress');
				const historyEntry = this.resumeHistoryService.create({
					name: resumeName,
					jobDescription: research.jobDescription,
					templateName: typstResult.templateName,
					model: 'pipeline-auto',
					data: typstResult.data as unknown as ResumeData,
					markdown: typstResult.yaml,
					durationMs: generationDurationMs,
					applicationId: application.id
				});

				// Persist the Typst-generated PDF alongside the history entry
				try {
					this.resumeHistoryService.persistTypstPdf(historyEntry.id, typstResult.pdfBuffer);
					this.log(runId, step, 'Typst PDF persisted to history', 'progress');
				} catch (pdfErr) {
					const pdfMsg = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
					this.log(runId, step, `Typst PDF persist warning: ${pdfMsg}`, 'warn');
				}

				// Convert to ResumeGenerationResult shape for downstream steps
				result = {
					markdown: typstResult.yaml,
					data: typstResult.data as unknown as ResumeData,
					templateName: typstResult.templateName
				};
			} else {
				// ── Markdown + Handlebars pipeline ───────────────────
				// Resolve the template: use the default (or user-configured) template
				const template = this.resumeTemplateService.getDefault();
				const templateId = template.id;

				this.log(
					runId,
					step,
					`Generating tailored resume via LLM (Markdown, template: ${template.name})…`,
					'progress',
					{ descriptionLength: enrichedDescription.length }
				);

				result = await this.resumeGenerationService.generate(enrichedDescription, templateId);
				const generationDurationMs = Date.now() - generationStartTime;

				this.checkCancelled(runId);

				this.log(
					runId,
					step,
					`Resume generated: ${result.markdown.length} chars, template: ${result.templateName}`,
					'progress'
				);

				// Save to resume history
				this.log(runId, step, 'Saving to resume history…', 'progress');
				this.resumeHistoryService.create({
					name: resumeName,
					jobDescription: research.jobDescription,
					templateId,
					templateName: result.templateName,
					model: 'pipeline-auto',
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

			const message = error instanceof Error ? error.message : String(error);
			this.log(runId, step, `Resume generation failed: ${message}`, 'error');
			finishStepAudit({
				status: 'error',
				detail: `Resume generation failed: ${message}`
			});
			throw new Error(`Resume step failed: ${message}`);
		}
	}

	/**
	 * Step 3: Apply — navigate to the job posting and attempt to fill out
	 * and submit the application form.
	 */
	private async executeApplyStep(
		runId: number,
		application: ApplicationWithSwimlane,
		resumeResult: ResumeGenerationResult
	): Promise<BrowserAutomationResult> {
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

			this.log(
				runId,
				step,
				`Navigating to job posting: ${application.job_description_url}`,
				'progress'
			);

			this.checkCancelled(runId);

			this.log(runId, step, 'Launching browser automation…', 'progress');
			const result = await this.browserAgentService.fillApplicationForm(application.id);

			this.checkCancelled(runId);

			// Log all discovered form fields
			if (result.completedFields.length > 0) {
				this.log(runId, step, `Filled ${result.completedFields.length} form fields`, 'progress', {
					fields: result.completedFields
				});

				const fieldEntries: Record<string, string> = {};
				for (const fieldSelector of result.completedFields) {
					fieldEntries[fieldSelector] = 'auto-filled';
				}
				await this.applicationService.updateApplicationFields(application.id, fieldEntries);
			}

			this.checkCancelled(runId);

			// Log missing fields
			if (result.missingFields.length > 0) {
				this.log(runId, step, `${result.missingFields.length} fields could not be filled`, 'warn', {
					missingFields: result.missingFields.map((f) => f.fieldName)
				});

				this.resourceService.create({
					applicationId: application.id,
					resourceType: 'error',
					title: 'Missing Form Fields',
					content: result.missingFields
						.map((f) => `${f.label} (${f.fieldType}) — ${f.required ? 'required' : 'optional'}`)
						.join('\n'),
					meta: { missingFields: result.missingFields }
				});
			}

			// Log errors
			if (result.errors.length > 0) {
				const errorSummary = result.errors.join('\n');
				this.log(
					runId,
					step,
					`Browser automation encountered ${result.errors.length} error(s)`,
					'warn',
					{
						errors: result.errors
					}
				);

				this.resourceService.create({
					applicationId: application.id,
					resourceType: 'error',
					title: 'Browser Automation Errors',
					content: errorSummary,
					meta: { errors: result.errors }
				});

				if (!result.success) {
					throw new Error(`Browser automation failed: ${errorSummary}`);
				}
			}

			this.log(runId, step, 'Closing browser…', 'progress');
			await this.browserAgentService.closeBrowser();

			this.pipelineService.completeStep(runId, step);
			this.log(
				runId,
				step,
				result.success
					? `Application submitted: ${result.completedFields.length} fields filled`
					: `Application attempted with ${result.missingFields.length} missing fields`,
				'progress'
			);

			finishStepAudit({
				status: result.success ? 'success' : 'warning',
				detail: result.success
					? `Application submitted to ${application.company}: ${result.completedFields.length} fields filled`
					: `Application attempted with ${result.missingFields.length} missing fields`,
				meta: {
					completedFields: result.completedFields.length,
					missingFields: result.missingFields.length,
					errors: result.errors
				}
			});

			return result;
		} catch (error) {
			if (error instanceof CancellationError) {
				// Best-effort browser cleanup on cancel
				try {
					await this.browserAgentService.closeBrowser();
				} catch {
					/* ignore */
				}
				throw error;
			}

			// Ensure browser is closed on failure
			try {
				await this.browserAgentService.closeBrowser();
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
}
