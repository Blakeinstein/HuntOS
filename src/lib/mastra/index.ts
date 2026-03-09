// src/lib/mastra/index.ts
// Mastra configuration — creates a Mastra instance with agents wired to app services

import { Mastra } from '@mastra/core';
import { LibSQLStore } from '@mastra/libsql';
import { Observability, DefaultExporter, SamplingStrategyType } from '@mastra/observability';
import { createServices } from '$lib/services';
import { db } from '$lib/db';
import { createProfileAgent } from './agents/profile-agent';
import { createResumeAgent } from './agents/resume-agent';
import type { ResumeAgentDeps } from './agents/resume-agent';
import {
	createJobBoardAgent,
	createJobBoardSubAgentRegistry,
	createLinkedInAgent,
	createGreenhouseAgent,
	createGenericAgent
} from './agents/job-board-agent/index';
import { createJobApplicationAgent } from './agents/job-application-agent/index';
import { logger } from './logger';
import { logToolCallToPipeline } from '$lib/services/helpers/pipelineContext';

const services = createServices(db);

const profileAgent = createProfileAgent(
	services.profileService,
	services.auditLogService,
	services.documentService
);

const resumeAgentDeps: ResumeAgentDeps = {
	linkSummaryService: services.linkSummaryService,
	linkSummaryVectorService: services.linkSummaryVectorService,
	linkSummaryQueue: services.linkSummaryQueue,
	auditLogService: services.auditLogService
};
const resumeAgent = createResumeAgent(resumeAgentDeps);
const jobBoardAgent = createJobBoardAgent();

// Job board scraping sub-agents — each is registered with dot-notation keys
const linkedInAgent = createLinkedInAgent();
const greenhouseAgent = createGreenhouseAgent();
const genericAgent = createGenericAgent();

// Shared tool-call callback — writes every browser tool invocation to the
// active pipeline step logs in real-time. Tool calls are intentionally NOT
// written to the audit_logs table; they should only appear inside the
// application pipeline log view.
const toolAuditCallback = {
	onToolCall: (evt: import('./tools/with-logging').ToolCallEvent) => {
		logToolCallToPipeline(evt.toolId, evt.input, evt.output, evt.success, evt.durationMs).catch(
			(err) => {
				logger.warn('[mastra] Pipeline tool-call log failed', { error: String(err) });
			}
		);
	}
};

// Unified job application agent — handles all sites with dynamic site-specific context
const jobApplicationAgent = createJobApplicationAgent(toolAuditCallback);

// Sub-agent registry for job board scraping (URL-based routing at runtime)
const subAgentRegistry = createJobBoardSubAgentRegistry();

export const mastra = new Mastra({
	agents: {
		// Profile & resume agents
		'profile-agent': profileAgent,
		'resume-agent': resumeAgent,

		// Job board scraping agents
		'job-board-agent': jobBoardAgent,
		'job-board-agent.linkedin': linkedInAgent,
		'job-board-agent.greenhouse': greenhouseAgent,
		'job-board-agent.generic': genericAgent,

		// Unified job application agent
		'job-application-agent': jobApplicationAgent
	},
	storage: new LibSQLStore({
		id: 'libsql-storage',
		url: 'file:./data/memory.db'
	}),
	logger,
	observability: new Observability({
		configs: {
			default: {
				serviceName: 'auto-job-app',
				sampling: { type: SamplingStrategyType.ALWAYS },
				exporters: [new DefaultExporter({ logLevel: 'debug' })]
			}
		}
	})
});

// Wire late-bound services that depend on the Mastra instance
services.withMastra(mastra, subAgentRegistry);

// Initialize and start the scheduler (fire-and-forget — don't block module load)
services.schedulerService
	.init()
	.then(() => services.schedulerService.start())
	.then(() => logger.debug('Scheduler started'))
	.catch((err) => logger.error('Failed to start scheduler', { error: String(err) }));

export { services, subAgentRegistry };
