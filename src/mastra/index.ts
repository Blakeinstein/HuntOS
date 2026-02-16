// src/mastra/index.ts
// Mastra configuration — creates a Mastra instance with agents wired to app services

import { Mastra } from '@mastra/core';
import { createServices } from '$lib/services';
import { db } from '$lib/db';
import { createProfileAgent } from './agents/profile-agent';

const services = createServices(db);

const profileAgent = createProfileAgent(services.profileService);

export const mastra = new Mastra({
	agents: {
		'profile-agent': profileAgent
	}
});
