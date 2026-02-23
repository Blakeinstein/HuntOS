// src/lib/services/services/applyPipelineExecutor.ts
// Orchestrates the 3-step apply pipeline: research → resume → apply.
//
// Each step is executed sequentially. Progress is persisted via the
// ApplicationPipelineService so the frontend can poll for updates.
// Audit logs are written at each step boundary for observability.
//
// On success the application is moved to "Applied".
// On failure the application is moved to "Action Required" and the
// error is recorded as a resource + audit log entry.

import type { ApplicationService, ApplicationWithSwimlane } from './application';
import type { ApplicationPipelineService, PipelineStep } from './applicationPipeline';
import type { ApplicationResourceService } from './applicationResource';
import type { AuditLogService } from './auditLog';
import type { ProfileService } from './profile';
import type { ResumeGenerationService, ResumeGenerationResult } from './resumeGeneration';
import type { ResumeHistoryService } from './resumeHistory';
import type { SwimlaneService } from './swimlane';
import type { BrowserAgentService, BrowserAutomationResult } from './browserAgent';

// ── Types ───────────────────────────────────────────────────────────

export interface PipelineExecutionResult {
	success: boolean;
	pipelineRunId: number;
	error?: string;
}

/**
 * Minimal interface for a "research" provider.
 *
 * In the initial implementation this does a simple fetch of the job URL
 * and stores the page content. A future version will integrate with an
 * LLM-powered research agent that also searches Google for company info.
 */
interface ResearchResult {
	jobDescription: string;
	companyInfo: string;
	roleResearch: string;
}

// ── Executor ────────────────────────────────────────────────────────

/**
 * Executes the full apply pipeline for a single application.
 *
 * ## Pipeline Steps
 *
 * 1. **Research** — Fetch the job posting page, extract the job description,
 *    and do supplemental research about the company and role. All gathered
 *    data is stored as `application_resources`.
 *
 * 2. **Resume** — Using the job description + research from step 1 and the
 *    active user's profile, generate a tailored resume via the
 *    `ResumeGenerationService`. The result is saved to resume history and
 *    also stored as a resource on the application.
 *
 * 3. **Apply** — Navigate to the job posting URL with the browser agent
 *    and attempt to fill out and submit the application form. Discovered
 *    form fields are logged as `application_fields`.
 *
 * Each step updates the pipeline run state and writes audit log entries.
 * If any step fails, the pipeline is marked as failed and the application
 * is moved to the "Action Required" swimlane.
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
	}

	// ── Public API ─────────────────────────────────────────────────

	/**
	 * Execute the full pipeline for the given application.
	 *
	 * This method is designed to be called from an API route handler.
	 * It runs all three steps sequentially and returns once the pipeline
	 * is complete (or has failed).
	 *
	 * The caller should NOT `await` this in the request handler if they
	 * want a non-blocking response — instead, fire-and-forget and let
	 * the frontend poll the pipeline status.
	 */
	async execute(applicationId: number): Promise<PipelineExecutionResult> {
		// 1. Validate the application
		const application = await this.applicationService.getApplication(applicationId);
		if (!application) {
			return { success: false, pipelineRunId: -1, error: 'Application not found' };
		}

		// Verify application is in Backlog
		if (application.swimlane_name.toLowerCase() !== 'backlog') {
			return {
				success: false,
				pipelineRunId: -1,
				error: `Application must be in Backlog to apply (current: ${application.swimlane_name})`
			};
		}

		// Check for existing active pipeline
		if (this.pipelineService.hasActiveRun(applicationId)) {
			return {
				success: false,
				pipelineRunId: -1,
				error: 'A pipeline is already running for this application'
			};
		}

		// 2. Create the pipeline run
		const run = this.pipelineService.create(applicationId);

		const finishAudit = this.auditLogService.start({
			category: 'browser',
			agent_id: 'apply-pipeline',
			title: `Apply pipeline started: ${application.company} — ${application.title}`,
			meta: { applicationId, pipelineRunId: run.id }
		});

		try {
			// Step 1: Research
			const research = await this.executeResearchStep(run.id, application);

			// Step 2: Resume
			const resumeResult = await this.executeResumeStep(run.id, application, research);

			// Step 3: Apply
			await this.executeApplyStep(run.id, application, resumeResult);

			// Mark pipeline as complete
			this.pipelineService.complete(run.id);

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
				meta: { applicationId, pipelineRunId: run.id }
			});

			return { success: true, pipelineRunId: run.id };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);

			// Mark pipeline as failed
			this.pipelineService.fail(run.id, message);

			// Log error as a resource
			this.resourceService.create({
				applicationId,
				resourceType: 'error',
				title: 'Pipeline Error',
				content: message,
				meta: {
					pipelineRunId: run.id,
					step: this.pipelineService.getById(run.id)?.current_step ?? 'unknown'
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
				meta: { applicationId, pipelineRunId: run.id, error: message }
			});

			return { success: false, pipelineRunId: run.id, error: message };
		}
	}

	// ── Step Executors ──────────────────────────────────────────────

	/**
	 * Step 1: Research — fetch job details and gather company/role info.
	 */
	private async executeResearchStep(
		runId: number,
		application: ApplicationWithSwimlane
	): Promise<ResearchResult> {
		const step: PipelineStep = 'research';
		this.pipelineService.startStep(runId, step);

		const finishStepAudit = this.auditLogService.start({
			category: 'browser',
			agent_id: 'apply-pipeline.research',
			title: `Researching: ${application.company} — ${application.title}`,
			meta: { applicationId: application.id, step }
		});

		try {
			let jobDescription = application.job_description ?? '';

			// If we have a URL but no description, try to fetch it
			if (!jobDescription && application.job_description_url) {
				try {
					const response = await fetch(application.job_description_url, {
						headers: {
							'User-Agent':
								'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
						},
						signal: AbortSignal.timeout(15_000)
					});

					if (response.ok) {
						const html = await response.text();
						// Extract text content (basic HTML stripping)
						jobDescription = this.stripHtml(html);
					}
				} catch (fetchError) {
					console.warn(
						'[ApplyPipeline] Failed to fetch job URL:',
						fetchError instanceof Error ? fetchError.message : fetchError
					);
				}
			}

			if (!jobDescription) {
				jobDescription = `${application.title} at ${application.company}`;
			}

			// Save the job description as a resource
			this.resourceService.create({
				applicationId: application.id,
				resourceType: 'job_description',
				title: 'Job Description',
				content: jobDescription,
				meta: { url: application.job_description_url }
			});

			// Supplemental research: basic company + role summary
			// In a future version, this would use an LLM agent to search the web
			const companyInfo = `Company: ${application.company}\nJob Title: ${application.title}\nPosting URL: ${application.job_description_url ?? 'N/A'}`;

			this.resourceService.create({
				applicationId: application.id,
				resourceType: 'company_info',
				title: `Company Research: ${application.company}`,
				content: companyInfo,
				meta: { company: application.company }
			});

			const roleResearch = `Role: ${application.title}\nCompany: ${application.company}\n\nKey Details:\n${jobDescription.slice(0, 2000)}`;

			this.resourceService.create({
				applicationId: application.id,
				resourceType: 'role_research',
				title: `Role Analysis: ${application.title}`,
				content: roleResearch,
				meta: { title: application.title, company: application.company }
			});

			// Update the application's job_description if we fetched a new one
			if (!application.job_description && jobDescription) {
				this.updateApplicationJobDescription(application.id, jobDescription);
			}

			this.pipelineService.completeStep(runId, step);

			finishStepAudit({
				status: 'success',
				detail: `Research completed for ${application.company}: ${jobDescription.length} chars of job description gathered`,
				meta: { jobDescriptionLength: jobDescription.length }
			});

			return { jobDescription, companyInfo, roleResearch };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
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
			// Combine all research into an enriched job description
			const enrichedDescription = [
				research.jobDescription,
				'',
				'--- Company Research ---',
				research.companyInfo,
				'',
				'--- Role Analysis ---',
				research.roleResearch
			].join('\n');

			const result = await this.resumeGenerationService.generate(enrichedDescription);

			// Save to resume history
			const startTime = Date.now();
			this.resumeHistoryService.create({
				name: `${application.company} — ${application.title}`,
				jobDescription: research.jobDescription,
				templateName: result.templateName,
				model: 'pipeline-auto',
				data: result.data,
				markdown: result.markdown,
				durationMs: Date.now() - startTime
			});

			// Save resume as a resource on the application
			this.resourceService.create({
				applicationId: application.id,
				resourceType: 'resume',
				title: `Generated Resume: ${result.templateName}`,
				content: result.markdown,
				meta: {
					templateName: result.templateName,
					sections: Object.keys(result.data)
				}
			});

			this.pipelineService.completeStep(runId, step);

			finishStepAudit({
				status: 'success',
				detail: `Resume generated for ${application.company}: ${result.markdown.length} chars`,
				meta: { templateName: result.templateName, markdownLength: result.markdown.length }
			});

			return result;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
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
				throw new Error('No job posting URL available — cannot auto-apply');
			}

			// Use the browser agent to fill out the form
			const result = await this.browserAgentService.fillApplicationForm(application.id);

			// Log all discovered form fields as application fields
			if (result.completedFields.length > 0) {
				const fieldEntries: Record<string, string> = {};
				for (const fieldSelector of result.completedFields) {
					fieldEntries[fieldSelector] = 'auto-filled';
				}
				await this.applicationService.updateApplicationFields(application.id, fieldEntries);
			}

			// Log missing fields
			if (result.missingFields.length > 0) {
				const missingEntries: Record<string, string> = {};
				for (const field of result.missingFields) {
					missingEntries[field.fieldName] = '';
				}
				// Update with missing status handled by service

				// Also log as a resource
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

			if (result.errors.length > 0) {
				const errorSummary = result.errors.join('\n');
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

			await this.browserAgentService.closeBrowser();

			this.pipelineService.completeStep(runId, step);

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
			// Ensure browser is closed on failure
			try {
				await this.browserAgentService.closeBrowser();
			} catch {
				// Ignore close errors
			}

			const message = error instanceof Error ? error.message : String(error);
			finishStepAudit({
				status: 'error',
				detail: `Apply step failed: ${message}`
			});
			throw new Error(`Apply step failed: ${message}`);
		}
	}

	// ── Helpers ─────────────────────────────────────────────────────

	/**
	 * Find a swimlane ID by its name.
	 */
	private async findSwimlaneByName(name: string): Promise<number | null> {
		const swimlanes = await this.swimlaneService.getSwimlanes();
		const match = swimlanes.find((s) => s.name.toLowerCase() === name.toLowerCase());
		return match?.id ?? null;
	}

	/**
	 * Update the application's job description in the database.
	 */
	private updateApplicationJobDescription(applicationId: number, jobDescription: string): void {
		// We access the db indirectly through applicationService — but since
		// ApplicationService doesn't expose a direct "update job description"
		// method, we store it as a resource. The job_description column on the
		// applications table can be updated in a future iteration.
		this.resourceService.create({
			applicationId,
			resourceType: 'job_description',
			title: 'Fetched Job Description',
			content: jobDescription
		});
	}

	/**
	 * Basic HTML tag stripping for extracting text content.
	 * This is intentionally simple — a proper implementation would use
	 * a DOM parser or the text extractor service.
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
			.slice(0, 50_000); // Cap at 50k chars
	}
}
