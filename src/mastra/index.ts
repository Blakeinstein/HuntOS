// src/mastra/index.ts
// Mastra configuration — creates a Mastra instance with agents wired to app services

import { Mastra } from '@mastra/core';
import { LibSQLStore } from '@mastra/libsql';
import { createServices } from '$lib/services';
import { db } from '$lib/db';
import { createProfileAgent } from './agents/profile-agent';
import { createJobBoardAgent } from './agents/job-board-agent';

const services = createServices(db);

const profileAgent = createProfileAgent(services.profileService);
const jobBoardAgent = createJobBoardAgent();

export const mastra = new Mastra({
	agents: {
		'profile-agent': profileAgent,
		'job-board-agent': jobBoardAgent
	},
	storage: new LibSQLStore({
		id: 'libsql-storage',
		url: 'file:./data/memory.db'
	})
});

// Wire late-bound services that depend on the Mastra instance
services.withMastra(mastra);

export { services };
