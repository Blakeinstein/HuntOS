// src/lib/mastra/agents/resume-agent.ts
// Resume writer agent — generates tailored, ATS-friendly resumes by analysing
// the user's profile against a target job description, using configurable
// Handlebars templates for output rendering.

import type { ProfileService } from '$lib/services/services/profile';
import type { AuditLogService } from '$lib/services/services/auditLog';
import type { DocumentService } from '$lib/services/services/document';
import type { ResumeGenerationService } from '$lib/services/services/resumeGeneration';
import type { ResumeTemplateService } from '$lib/services/services/resumeTemplate';
import type { ResumeHistoryService } from '$lib/services/services/resumeHistory';
import { createGetProfileTool } from '../tools/profile-tools';
import { createSearchDocumentsTool } from '../tools/profile/index';
import { createGenerateResumeTool, createListTemplatesTool } from '../tools/resume/index';
import { withToolLogging } from '../tools/with-logging';
import { createAgent } from './create-agent';

const RESUME_MODEL = 'z-ai/glm-4.7-flash';

export function createResumeAgent(
	profileService: ProfileService,
	auditLogService: AuditLogService,
	documentService: DocumentService,
	resumeGenerationService: ResumeGenerationService,
	resumeTemplateService: ResumeTemplateService,
	resumeHistoryService: ResumeHistoryService
) {
	return createAgent({
		id: 'resume-agent',
		name: 'Resume Writer Agent',
		model: RESUME_MODEL,
		tools: {
			// Read-only profile access — the resume agent doesn't need to modify the profile
			getProfile: withToolLogging(createGetProfileTool(profileService)),

			// RAG document search — find precise details from uploaded resumes, certificates, etc.
			searchDocuments: withToolLogging(createSearchDocumentsTool(documentService, auditLogService)),

			// Resume template management — list available Handlebars templates
			listTemplates: withToolLogging(createListTemplatesTool(resumeTemplateService)),

			// Core generation — runs the full pipeline: profile → LLM → template → Markdown
			// Now also pushes audit events and saves to resume history
			generateResume: withToolLogging(
				createGenerateResumeTool(resumeGenerationService, auditLogService, resumeHistoryService)
			)
		}
	});
}
