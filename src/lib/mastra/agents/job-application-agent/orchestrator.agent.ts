import { createAgent } from '../create-agent';
import { ApplicationSubAgentRegistry } from './registry';
import { createLinkedInApplicationAgent } from './linkedin.agent';
import { createGreenhouseApplicationAgent } from './greenhouse.agent';
import { createGenericApplicationAgent } from './generic.agent';
import type { ToolLoggingOptions } from '../../tools/with-logging';
import {
	applicationRoutingDecisionSchema,
	jobApplicationRequestContextSchema,
	type JobApplicationRequestContext
} from './types';

/**
 * Creates and populates the application sub-agent registry with all known
 * site-specific application agents.
 *
 * Entries are evaluated in registration order — more specific patterns
 * are registered first, with the generic fallback always last.
 *
 * @example
 * ```ts
 * const registry = createApplicationSubAgentRegistry();
 * const entry = registry.resolveOrThrow('https://boards.greenhouse.io/acme/jobs/123');
 * const agent = entry.create(); // Greenhouse-specific application agent
 * ```
 */
export function createApplicationSubAgentRegistry(
	toolLogging?: ToolLoggingOptions
): ApplicationSubAgentRegistry {
	const registry = new ApplicationSubAgentRegistry();

	registry
		.register({
			site: 'LinkedIn',
			agentId: 'job-application-agent.linkedin',
			match: (url) => /linkedin\.com/i.test(url),
			create: () => createLinkedInApplicationAgent(toolLogging)
		})
		.register({
			site: 'Greenhouse',
			agentId: 'job-application-agent.greenhouse',
			match: (url) => /greenhouse\.io/i.test(url),
			create: () => createGreenhouseApplicationAgent(toolLogging)
		})
		.register({
			site: 'Generic',
			agentId: 'job-application-agent.generic',
			match: () => true, // catch-all fallback — always matches
			create: () => createGenericApplicationAgent(toolLogging)
		});

	return registry;
}

/**
 * Creates the top-level job application orchestrator agent.
 *
 * This agent does NOT fill out application forms itself. Instead, it
 * analyzes the target application URL and returns a routing decision
 * indicating which site-specific sub-agent should handle the actual
 * form-filling and submission.
 *
 * The orchestrator also inspects the page to determine:
 * - Whether login/authentication is required before applying.
 * - Whether the form uses a known ATS (Greenhouse, Lever, etc.).
 * - Any unusual characteristics that should inform the sub-agent strategy.
 *
 * The orchestrator's prompt is loaded from:
 *   `src/lib/mastra/prompts/job-application-agent/job-application-agent.md`
 *
 * It receives the full application request context but only uses the URL
 * and a quick page inspection to make its routing decision.
 *
 * @example
 * ```ts
 * import { RequestContext } from '@mastra/core/request-context';
 *
 * const orchestrator = createJobApplicationAgent();
 * const ctx = new RequestContext<JobApplicationRequestContext>();
 * ctx.set('application-url', 'https://boards.greenhouse.io/acme/jobs/123');
 * ctx.set('user-profile', JSON.stringify(profileData));
 * ctx.set('job-description', jobDescriptionText);
 * ctx.set('resume-data', '{}');
 * ctx.set('resume-file-path', '');
 *
 * const result = await orchestrator.generate('Route this application request.', {
 *   requestContext: ctx,
 *   structuredOutput: { schema: applicationRoutingDecisionSchema },
 * });
 *
 * // result.object => {
 * //   detected_site: "Greenhouse",
 * //   sub_agent_id: "job-application-agent.greenhouse",
 * //   application_url: "https://boards.greenhouse.io/acme/jobs/123",
 * //   confidence: "high",
 * //   requires_login: false,
 * //   notes: "Standard Greenhouse application form detected."
 * // }
 * ```
 */
export function createJobApplicationAgent() {
	return createAgent({
		id: 'job-application-agent',
		name: 'Job Application Orchestrator Agent',
		requestContextSchema: jobApplicationRequestContextSchema,
		dynamicContext: ({ requestContext }) => ({
			'Application URL': `\`${requestContext.get('application-url') as JobApplicationRequestContext['application-url']}\``,
			'User Profile': `\`\`\`json\n${requestContext.get('user-profile') as JobApplicationRequestContext['user-profile']}\n\`\`\``,
			'Job Description': `\`\`\`\n${requestContext.get('job-description') as JobApplicationRequestContext['job-description']}\n\`\`\``,
			'Resume Data': `\`\`\`json\n${requestContext.get('resume-data') as JobApplicationRequestContext['resume-data']}\n\`\`\``,
			'Resume File Path': `\`${requestContext.get('resume-file-path') as JobApplicationRequestContext['resume-file-path']}\``
		})
		// No tools — the orchestrator only analyzes the URL and returns a routing decision.
	});
}

export { applicationRoutingDecisionSchema };
