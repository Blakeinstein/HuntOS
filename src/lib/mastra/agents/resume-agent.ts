// src/lib/mastra/agents/resume-agent.ts
// Resume writer agent factory.
//
// The agent is primarily a structured-output agent, but it is also given a
// semantic search tool over the candidate's scraped link summaries
// (GitHub, LinkedIn, Portfolio, etc.) so it can pull richer project and
// experience context when tailoring a resume to a specific job description.

import { env } from '$env/dynamic/private';
import { createAgent } from './create-agent';
import { createSearchLinkSummariesTool } from '../tools/resume/index';
import { withToolLogging } from '../tools/with-logging';
import type { LinkSummaryVectorService } from '$lib/services/services/linkSummaryVector';
import type { AuditLogService } from '$lib/services/services/auditLog';

export interface ResumeAgentDeps {
	linkSummaryVectorService: LinkSummaryVectorService;
	auditLogService: AuditLogService;
}

export function createResumeAgent(deps: ResumeAgentDeps) {
	const { linkSummaryVectorService, auditLogService } = deps;

	return createAgent({
		id: 'resume-agent',
		name: 'Resume Writer Agent',
		model: env.RESUME_AGENT_MODEL ?? 'openrouter/qwen/qwen3-30b-a3b-instruct-2507',
		tools: {
			searchLinkSummaries: withToolLogging(
				createSearchLinkSummariesTool(linkSummaryVectorService, auditLogService)
			)
		},
		dynamicContext: ({ requestContext }) => ({
			'Output Format Instructions': requestContext.get('format-instructions') ?? ''
		})
	});
}
