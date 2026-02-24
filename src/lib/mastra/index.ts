// src/lib/mastra/index.ts
// Mastra configuration — creates a Mastra instance with agents wired to app services

import { Mastra } from '@mastra/core';
import { LibSQLStore } from '@mastra/libsql';
import { Observability, DefaultExporter, SamplingStrategyType } from '@mastra/observability';
import { createServices } from '$lib/services';
import { db } from '$lib/db';
import { createProfileAgent } from './agents/profile-agent';
import { createResumeAgent } from './agents/resume-agent';
import {
	createJobBoardAgent,
	createJobBoardSubAgentRegistry,
	createLinkedInAgent,
	createGreenhouseAgent,
	createGenericAgent
} from './agents/job-board-agent/index';
import {
	createJobApplicationAgent,
	createApplicationSubAgentRegistry,
	createLinkedInApplicationAgent,
	createGreenhouseApplicationAgent,
	createGenericApplicationAgent
} from './agents/job-application-agent/index';
import { logger } from './logger';

const services = createServices(db);

const profileAgent = createProfileAgent(
	services.profileService,
	services.auditLogService,
	services.documentService
);
const resumeAgent = createResumeAgent(
	services.profileService,
	services.auditLogService,
	services.documentService,
	services.resumeGenerationService,
	services.resumeTemplateService,
	services.resumeHistoryService
);
const jobBoardAgent = createJobBoardAgent();

// Job board scraping sub-agents — each is registered with dot-notation keys
const linkedInAgent = createLinkedInAgent();
const greenhouseAgent = createGreenhouseAgent();
const genericAgent = createGenericAgent();

// Shared tool-call audit callback — routes every browser tool invocation
// to the audit_logs table so individual tool calls are visible in the UI.
const toolAuditCallback = {
	onToolCall: (evt: import('./tools/with-logging').ToolCallEvent) => {
		services.auditLogService.create({
			category: 'browser',
			agent_id: 'job-application-agent',
			status: evt.success ? 'success' : 'error',
			title: `Tool: ${evt.toolId}`,
			detail: evt.success
				? `${evt.toolId}(${Object.entries(evt.input)
						.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
						.join(
							', '
						)}) → ${typeof evt.output === 'object' ? JSON.stringify(evt.output) : String(evt.output)}`.slice(
						0,
						500
					)
				: `${evt.toolId} failed: ${evt.error}`,
			duration_ms: evt.durationMs,
			meta: {
				input: evt.input,
				...(evt.output ? { output: evt.output } : {}),
				...(evt.error ? { error: evt.error } : {})
			}
		});
	}
};

// Job application sub-agents — responsible for filling out and submitting applications
const jobApplicationAgent = createJobApplicationAgent();
const linkedInApplicationAgent = createLinkedInApplicationAgent(toolAuditCallback);
const greenhouseApplicationAgent = createGreenhouseApplicationAgent(toolAuditCallback);
const genericApplicationAgent = createGenericApplicationAgent(toolAuditCallback);

// Sub-agent registries for URL-based routing at runtime
const subAgentRegistry = createJobBoardSubAgentRegistry();
const applicationSubAgentRegistry = createApplicationSubAgentRegistry(toolAuditCallback);

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

		// Job application agents
		'job-application-agent': jobApplicationAgent,
		'job-application-agent.linkedin': linkedInApplicationAgent,
		'job-application-agent.greenhouse': greenhouseApplicationAgent,
		'job-application-agent.generic': genericApplicationAgent
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
services.withMastra(mastra, subAgentRegistry, applicationSubAgentRegistry);

export { services, subAgentRegistry, applicationSubAgentRegistry };
