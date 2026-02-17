// src/lib/mastra/index.ts
// Mastra configuration — creates a Mastra instance with agents wired to app services

import { Mastra } from '@mastra/core';
import { LibSQLStore } from '@mastra/libsql';
import { Observability, DefaultExporter, SamplingStrategyType } from '@mastra/observability';
import { createServices } from '$lib/services';
import { db } from '$lib/db';
import { createProfileAgent } from './agents/profile-agent';
import {
	createJobBoardAgent,
	createJobBoardSubAgentRegistry,
	createLinkedInAgent,
	createGreenhouseAgent,
	createGenericAgent
} from './agents/job-board-agent/index';
import { logger } from './logger';

const services = createServices(db);

const profileAgent = createProfileAgent(services.profileService);
const jobBoardAgent = createJobBoardAgent();

// Site-specific sub-agents — each is registered with dot-notation keys
const linkedInAgent = createLinkedInAgent();
const greenhouseAgent = createGreenhouseAgent();
const genericAgent = createGenericAgent();

// Sub-agent registry for URL-based routing at runtime
const subAgentRegistry = createJobBoardSubAgentRegistry();

export const mastra = new Mastra({
	agents: {
		'profile-agent': profileAgent,
		'job-board-agent': jobBoardAgent,
		'job-board-agent.linkedin': linkedInAgent,
		'job-board-agent.greenhouse': greenhouseAgent,
		'job-board-agent.generic': genericAgent
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
