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

export { services, subAgentRegistry };
