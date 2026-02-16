import { Database } from '$lib/services/services/database';
import { ApplicationService } from '$lib/services/services/application';
import { SwimlaneService } from '$lib/services/services/swimlane';
import { ProfileService } from '$lib/services/services/profile';
import { ResumeService } from '$lib/services/services/resume';
import { JobBoardService } from '$lib/services/services/jobBoard';
import { EmailMonitorService } from '$lib/services/services/emailMonitor';
import { BrowserAgentService } from '$lib/services/services/browserAgent';

export interface ServiceContainer {
	applicationService: ApplicationService;
	profileService: ProfileService;
	resumeService: ResumeService;
	swimlaneService: SwimlaneService;
	jobBoardService: JobBoardService;
	emailMonitorService: EmailMonitorService;
	browserAgentService: BrowserAgentService;
}

export function createServices(db: Database): ServiceContainer {
	const profileService = new ProfileService(db);
	const resumeService = new ResumeService(db, profileService);

	return {
		applicationService: new ApplicationService(db),
		profileService,
		resumeService,
		swimlaneService: new SwimlaneService(db),
		jobBoardService: new JobBoardService(db),
		emailMonitorService: new EmailMonitorService(db),
		browserAgentService: new BrowserAgentService(db, profileService, resumeService)
	};
}
