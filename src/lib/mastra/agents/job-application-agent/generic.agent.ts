import { browserTools } from '../../tools/browser';
import { withToolLoggingAll, type ToolLoggingOptions } from '../../tools/with-logging';
import { createAgent } from '../create-agent';
import { jobApplicationRequestContextSchema, type JobApplicationRequestContext } from './types';

/**
 * Creates a generic job application sub-agent used as a fallback
 * when no site-specific agent is registered for the target URL.
 *
 * This agent uses heuristic-based form-filling strategies — inspecting
 * the accessibility tree, trying multiple CSS selector patterns, and
 * using LLM reasoning to semantically map profile fields to form inputs.
 *
 * It handles arbitrary application form layouts including multi-step
 * wizards, modals, and embedded iframes.
 *
 * Prompt: `prompts/job-application-agent/job-application-agent.generic.md`
 */
export function createGenericApplicationAgent(toolLogging?: ToolLoggingOptions) {
	return createAgent({
		id: 'job-application-agent.generic',
		name: 'Generic Job Application Agent',
		requestContextSchema: jobApplicationRequestContextSchema,
		dynamicContext: ({ requestContext }) => ({
			'Application URL': `\`${requestContext.get('application-url') as JobApplicationRequestContext['application-url']}\``,
			'User Profile': `\`\`\`json\n${requestContext.get('user-profile') as JobApplicationRequestContext['user-profile']}\n\`\`\``,
			'Job Description': `\`\`\`\n${requestContext.get('job-description') as JobApplicationRequestContext['job-description']}\n\`\`\``,
			'Resume Data': `\`\`\`json\n${requestContext.get('resume-data') as JobApplicationRequestContext['resume-data']}\n\`\`\``,
			'Resume File Path': `\`${requestContext.get('resume-file-path') as JobApplicationRequestContext['resume-file-path']}\``
		}),
		tools: {
			...withToolLoggingAll(browserTools, toolLogging)
		}
	});
}
