import { Database } from '$lib/services/services/database';
import { ApplicationService } from '$lib/services/services/application';
import { SwimlaneService } from '$lib/services/services/swimlane';
import { ProfileService } from '$lib/services/services/profile';
import { ResumeService } from '$lib/services/services/resume';
import { ResumeGenerationService } from '$lib/services/services/resumeGeneration';
import { ResumeTemplateService } from '$lib/services/services/resumeTemplate';
import { ResumeHistoryService } from '$lib/services/services/resumeHistory';
import { JobBoardService } from '$lib/services/services/jobBoard';
import { JobBoardScraperService } from '$lib/services/services/jobBoardScraper';
import { EmailMonitorService } from '$lib/services/services/emailMonitor';
import { BrowserAgentService } from '$lib/services/services/browserAgent';
import { AuditLogService } from '$lib/services/services/auditLog';
import { DocumentService } from '$lib/services/services/document';
import type { Mastra } from '@mastra/core';
import type { SubAgentRegistry } from '$lib/mastra/agents/job-board-agent/registry';

export interface ServiceContainer {
	applicationService: ApplicationService;
	profileService: ProfileService;
	resumeService: ResumeService;
	resumeGenerationService: ResumeGenerationService;
	resumeTemplateService: ResumeTemplateService;
	resumeHistoryService: ResumeHistoryService;
	swimlaneService: SwimlaneService;
	jobBoardService: JobBoardService;
	jobBoardScraperService: JobBoardScraperService | null;
	emailMonitorService: EmailMonitorService;
	browserAgentService: BrowserAgentService;
	auditLogService: AuditLogService;
	documentService: DocumentService;

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
	const resumeHistoryService = new ResumeHistoryService(db);
	const jobBoardService = new JobBoardService(db);
	const auditLogService = new AuditLogService(db);
	const documentService = new DocumentService(db, auditLogService);

	const container: ServiceContainer = {
		applicationService: new ApplicationService(db),
		profileService,
		resumeService,
		resumeGenerationService,
		resumeTemplateService,
		resumeHistoryService,
		swimlaneService: new SwimlaneService(db),
		jobBoardService,
		jobBoardScraperService: null,
		emailMonitorService: new EmailMonitorService(db),
		browserAgentService: new BrowserAgentService(db, profileService, resumeService),
		auditLogService,
		documentService,

		withMastra(mastra: Mastra, subAgentRegistry: SubAgentRegistry) {
			container.jobBoardScraperService = new JobBoardScraperService(
				mastra,
				profileService,
				jobBoardService,
				subAgentRegistry,
				auditLogService
			);
		}
	};

	return container;
}
