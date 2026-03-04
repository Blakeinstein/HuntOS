import { Database } from '$lib/services/services/database';
import { ApplicationService } from '$lib/services/services/application';
import { SwimlaneService } from '$lib/services/services/swimlane';
import { ProfileService } from '$lib/services/services/profile';
import { ResumeService } from '$lib/services/services/resume';
import { ResumeGenerationService } from '$lib/services/services/resumeGeneration';
import { ResumeTemplateService } from '$lib/services/services/resumeTemplate';
import { ResumeHistoryService } from '$lib/services/services/resumeHistory';
import { PdfService } from '$lib/services/services/pdfService';
import { TypstResumeService } from '$lib/services/services/typstResume';
import { AppSettingsService } from '$lib/services/services/appSettings';
import { JobBoardService } from '$lib/services/services/jobBoard';
import { JobBoardScraperService } from '$lib/services/services/jobBoardScraper';
import { EmailMonitorService } from '$lib/services/services/emailMonitor';
import { BrowserAgentService } from '$lib/services/services/browserAgent';
import { AuditLogService } from '$lib/services/services/auditLog';
import { DocumentService } from '$lib/services/services/document';
import { ApplicationResourceService } from '$lib/services/services/applicationResource';
import { ApplicationPipelineService } from '$lib/services/services/applicationPipeline';
import { ApplyPipelineExecutor } from '$lib/services/services/applyPipelineExecutor';
import { ResumeAgentService } from '$lib/services/services/resumeAgent';
import type { Mastra } from '@mastra/core';
import type { SubAgentRegistry } from '$lib/mastra/agents/job-board-agent/registry';

export interface ServiceContainer {
	applicationService: ApplicationService;
	profileService: ProfileService;
	resumeService: ResumeService;
	resumeGenerationService: ResumeGenerationService;
	resumeTemplateService: ResumeTemplateService;
	resumeHistoryService: ResumeHistoryService;
	resumeAgentService: ResumeAgentService;
	pdfService: PdfService;
	typstResumeService: TypstResumeService;
	appSettingsService: AppSettingsService;
	swimlaneService: SwimlaneService;
	jobBoardService: JobBoardService;
	jobBoardScraperService: JobBoardScraperService | null;
	emailMonitorService: EmailMonitorService;
	browserAgentService: BrowserAgentService;
	auditLogService: AuditLogService;
	documentService: DocumentService;
	applicationResourceService: ApplicationResourceService;
	applicationPipelineService: ApplicationPipelineService;
	applyPipelineExecutor: ApplyPipelineExecutor;

	/**
	 * Wire late-bound services that depend on the Mastra instance.
	 * Call this once after both `createServices()` and `new Mastra()` have run
	 * to break the circular dependency between the service container and Mastra.
	 */
	withMastra(mastra: Mastra, subAgentRegistry: SubAgentRegistry): void;
}

export function createServices(db: Database): ServiceContainer {
	const profileService = new ProfileService(db);
	const resumeService = new ResumeService(db, profileService);
	const resumeTemplateService = new ResumeTemplateService(db);
	const resumeGenerationService = new ResumeGenerationService(
		profileService,
		resumeTemplateService
	);
	const pdfService = new PdfService();
	const typstResumeService = new TypstResumeService(profileService);
	const appSettingsService = new AppSettingsService(db);
	const resumeHistoryService = new ResumeHistoryService(db, undefined, pdfService);
	const jobBoardService = new JobBoardService(db);
	const auditLogService = new AuditLogService(db);
	const resumeAgentService = new ResumeAgentService();
	const documentService = new DocumentService(db, auditLogService);
	const applicationService = new ApplicationService(db);
	const swimlaneService = new SwimlaneService(db);
	const browserAgentService = new BrowserAgentService(db, profileService, resumeService);
	const applicationResourceService = new ApplicationResourceService(db);
	const applicationPipelineService = new ApplicationPipelineService(db);
	const applyPipelineExecutor = new ApplyPipelineExecutor({
		applicationService,
		pipelineService: applicationPipelineService,
		resourceService: applicationResourceService,
		auditLogService,
		profileService,
		resumeGenerationService,
		resumeHistoryService,
		swimlaneService,
		browserAgentService,
		appSettingsService,
		typstResumeService,
		resumeTemplateService
	});

	const container: ServiceContainer = {
		applicationService,
		profileService,
		resumeService,
		resumeGenerationService,
		resumeTemplateService,
		resumeHistoryService,
		resumeAgentService,
		pdfService,
		typstResumeService,
		appSettingsService,
		swimlaneService,
		jobBoardService,
		jobBoardScraperService: null,
		emailMonitorService: new EmailMonitorService(db),
		browserAgentService,
		auditLogService,
		documentService,
		applicationResourceService,
		applicationPipelineService,
		applyPipelineExecutor,

		withMastra(mastra: Mastra, subAgentRegistry: SubAgentRegistry) {
			container.jobBoardScraperService = new JobBoardScraperService(
				mastra,
				profileService,
				jobBoardService,
				subAgentRegistry,
				auditLogService
			);
			resumeAgentService.setMastra(mastra);
			resumeGenerationService.setAgentService(resumeAgentService);
			typstResumeService.setAgentService(resumeAgentService);
			applyPipelineExecutor.setMastra(mastra);
		}
	};

	return container;
}
