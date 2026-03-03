// src/lib/mastra/agents/profile-agent.ts
// Profile builder agent — conversational agent that gathers user information,
// parses resumes, scrapes external links, searches uploaded documents via RAG,
// and produces a comprehensive profile description.

import type { ProfileService } from '$lib/services/services/profile';
import type { AuditLogService } from '$lib/services/services/auditLog';
import type { DocumentService } from '$lib/services/services/document';
import {
	createUpdateProfileTool,
	createGetProfileTool,
	createGetIncompleteFieldsTool
} from '../tools/profile-tools';
import {
	createParseResumeTool,
	createScrapeWebsiteTool,
	createSaveProfileDescriptionTool,
	createSearchDocumentsTool
} from '../tools/profile/index';
import { withToolLogging } from '../tools/with-logging';
import { env } from '$env/dynamic/private';
import { createAgent } from './create-agent';

export function createProfileAgent(
	profileService: ProfileService,
	auditLogService: AuditLogService,
	documentService: DocumentService
) {
	return createAgent({
		id: 'profile-agent',
		name: 'Profile Builder Agent',
		model: env.PROFILE_AGENT_MODEL ?? 'z-ai/glm-4.7-flash',
		tools: {
			// Core profile CRUD tools
			updateProfile: withToolLogging(createUpdateProfileTool(profileService)),
			getProfile: withToolLogging(createGetProfileTool(profileService)),
			getIncompleteFields: withToolLogging(createGetIncompleteFieldsTool(profileService)),

			// Resume parsing tool — extracts structured fields from pasted resume text
			parseResume: withToolLogging(createParseResumeTool(profileService, auditLogService)),

			// Website scraping tool — fetches and extracts text from URLs (GitHub, LinkedIn, etc.)
			scrapeWebsite: withToolLogging(createScrapeWebsiteTool(profileService, auditLogService)),

			// Description generation tool — saves the comprehensive semi-structured profile summary
			saveProfileDescription: withToolLogging(
				createSaveProfileDescriptionTool(profileService, auditLogService)
			),

			// RAG document search — semantic search across uploaded user documents via sqlite-vec
			searchDocuments: withToolLogging(createSearchDocumentsTool(documentService, auditLogService))
		}
	});
}
