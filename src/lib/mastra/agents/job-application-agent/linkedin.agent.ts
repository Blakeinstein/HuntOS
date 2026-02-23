import { browserTools } from '../../tools/browser';
import { withToolLoggingAll } from '../../tools/with-logging';
import { createAgent } from '../create-agent';
import {
	jobApplicationRequestContextSchema,
	type JobApplicationRequestContext
} from './types';

/**
 * Creates a LinkedIn-specific job application sub-agent.
 *
 * This sub-agent is tailored for LinkedIn's Easy Apply flow and external
 * application redirects. It understands LinkedIn's multi-step modal forms,
 * resume upload widgets, and the various field patterns used across the
 * LinkedIn application experience.
 *
 * Key LinkedIn-specific behaviours:
 * - Detects "Easy Apply" vs "Apply on company site" and handles both.
 * - Navigates the multi-step Easy Apply modal (contact info → resume →
 *   additional questions → review → submit).
 * - Handles LinkedIn's file upload widget for resume/cover letter.
 * - Recognises LinkedIn's pre-filled fields (name, email, phone) and
 *   verifies they are correct before proceeding.
 * - Detects "Application submitted" confirmation or error states.
 *
 * Prompt: `prompts/job-application-agent/job-application-agent.linkedin.md`
 *
 * @example
 * ```ts
 * import { RequestContext } from '@mastra/core/request-context';
 *
 * const agent = createLinkedInApplicationAgent();
 * const ctx = new RequestContext<JobApplicationRequestContext>();
 * ctx.set('application-url', 'https://www.linkedin.com/jobs/view/123456');
 * ctx.set('user-profile', JSON.stringify(profileData));
 * ctx.set('job-description', jobDescriptionText);
 * ctx.set('resume-data', JSON.stringify(resumeData));
 * ctx.set('resume-file-path', '/path/to/resume.pdf');
 *
 * const result = await agent.generate('Apply to this LinkedIn job posting.', {
 *   requestContext: ctx,
 *   structuredOutput: { schema: applicationResultSchema },
 * });
 * ```
 */
export function createLinkedInApplicationAgent() {
	return createAgent({
		id: 'job-application-agent.linkedin',
		name: 'LinkedIn Job Application Agent',
		requestContextSchema: jobApplicationRequestContextSchema,
		dynamicContext: ({ requestContext }) => ({
			'Application URL': `\`${requestContext.get('application-url') as JobApplicationRequestContext['application-url']}\``,
			'User Profile': `\`\`\`json\n${requestContext.get('user-profile') as JobApplicationRequestContext['user-profile']}\n\`\`\``,
			'Job Description': `\`\`\`\n${requestContext.get('job-description') as JobApplicationRequestContext['job-description']}\n\`\`\``,
			'Resume Data': `\`\`\`json\n${requestContext.get('resume-data') as JobApplicationRequestContext['resume-data']}\n\`\`\``,
			'Resume File Path': `\`${requestContext.get('resume-file-path') as JobApplicationRequestContext['resume-file-path']}\``
		}),
		tools: {
			...withToolLoggingAll(browserTools)
		}
	});
}
