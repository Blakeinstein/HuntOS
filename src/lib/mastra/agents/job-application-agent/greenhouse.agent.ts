import { browserTools } from '../../tools/browser';
import { withToolLoggingAll } from '../../tools/with-logging';
import { createAgent } from '../create-agent';
import {
	jobApplicationRequestContextSchema,
	type JobApplicationRequestContext
} from './types';

/**
 * Creates a Greenhouse ATS-specific job application sub-agent.
 *
 * This sub-agent is tailored for Greenhouse-hosted application forms,
 * which appear on `boards.greenhouse.io/{company}/jobs/{id}` URLs or
 * custom-domain variants that embed the Greenhouse iframe.
 *
 * Key Greenhouse-specific behaviours:
 * - Recognises the standard Greenhouse application form layout with
 *   sections: personal info, resume/cover letter, custom questions,
 *   EEOC/demographic fields, and submit.
 * - Handles the single-page form (Greenhouse does NOT use multi-step
 *   modals — all fields are on one long page).
 * - Detects Greenhouse's file upload widget (`#resume` / `#cover_letter`)
 *   and uploads the generated resume PDF.
 * - Fills standard fields: first name, last name, email, phone, LinkedIn
 *   URL, website, and location using the user profile.
 * - Handles custom questions (free-text, select, checkbox, radio) using
 *   the job description and resume data for context.
 * - Skips optional EEOC/demographic sections when allowed (gender, race,
 *   veteran status, disability) — never fabricates demographic data.
 * - Detects the "Application submitted" confirmation page or inline
 *   validation errors after submit.
 *
 * Prompt: `prompts/job-application-agent/job-application-agent.greenhouse.md`
 *
 * @example
 * ```ts
 * import { RequestContext } from '@mastra/core/request-context';
 *
 * const agent = createGreenhouseApplicationAgent();
 * const ctx = new RequestContext<JobApplicationRequestContext>();
 * ctx.set('application-url', 'https://boards.greenhouse.io/acme/jobs/123456');
 * ctx.set('user-profile', JSON.stringify(profileData));
 * ctx.set('job-description', jobDescriptionText);
 * ctx.set('resume-data', JSON.stringify(resumeData));
 * ctx.set('resume-file-path', '/path/to/resume.pdf');
 *
 * const result = await agent.generate('Apply to this Greenhouse job posting.', {
 *   requestContext: ctx,
 *   structuredOutput: { schema: applicationResultSchema },
 * });
 * ```
 */
export function createGreenhouseApplicationAgent() {
	return createAgent({
		id: 'job-application-agent.greenhouse',
		name: 'Greenhouse Job Application Agent',
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
