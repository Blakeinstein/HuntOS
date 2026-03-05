// src/lib/mastra/agents/resume-agent.ts
// Resume writer agent factory.
//
// The agent is primarily a structured-output agent, but it is also given two
// tools over the candidate's scraped link summaries (GitHub, LinkedIn, Portfolio, etc.):
//
//   - scrapeAndEmbedLink  — scrape a URL on demand, generate an AI summary,
//                           and index the embedding so it is immediately searchable.
//   - searchLinkSummaries — semantic search across all already-indexed summaries.
//
// Together these allow the agent to fetch fresh content for any URL the user
// provides and then query it for relevant context when tailoring a resume.

import { env } from '$env/dynamic/private';
import { createAgent } from './create-agent';
import { createSearchLinkSummariesTool, createScrapeAndEmbedLinkTool } from '../tools/resume/index';
import { withToolLogging } from '../tools/with-logging';
import type { LinkSummaryVectorService } from '$lib/services/services/linkSummaryVector';
import type { LinkSummaryService } from '$lib/services/services/linkSummary';
import type { LinkSummaryQueue } from '$lib/services/services/linkSummaryQueue';
import type { AuditLogService } from '$lib/services/services/auditLog';

export interface ResumeAgentDeps {
	linkSummaryService: LinkSummaryService;
	linkSummaryVectorService: LinkSummaryVectorService;
	linkSummaryQueue: LinkSummaryQueue;
	auditLogService: AuditLogService;
}

export function createResumeAgent(deps: ResumeAgentDeps) {
	const { linkSummaryService, linkSummaryVectorService, linkSummaryQueue, auditLogService } = deps;

	return createAgent({
		id: 'resume-agent',
		name: 'Resume Writer Agent',
		model: env.RESUME_AGENT_MODEL ?? 'openrouter/qwen/qwen3-30b-a3b-instruct-2507',
		tools: {
			scrapeAndEmbedLink: withToolLogging(
				createScrapeAndEmbedLinkTool({
					linkSummaryService,
					linkSummaryVectorService,
					linkSummaryQueue,
					auditLogService
				})
			),
			searchLinkSummaries: withToolLogging(
				createSearchLinkSummariesTool(linkSummaryVectorService, auditLogService)
			)
		},
		dynamicContext: ({ requestContext }) => ({
			'Output Format Instructions': requestContext.get('format-instructions') ?? ''
		})
	});
}
