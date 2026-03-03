import { browserTools } from '../../tools/browser';
import { withToolLoggingAll, type ToolLoggingOptions } from '../../tools/with-logging';
import { createAgent } from '../create-agent';
import { jobApplicationRequestContextSchema, type JobApplicationRequestContext } from './types';

const ORCHESTRATOR_MODEL =
	process.env.JOB_APPLICATION_AGENT_MODEL ?? 'openrouter/qwen/qwen3.5-flash-02-23';
/**
 * Creates the unified job application agent.
 *
 * This is a single, central agent that handles ALL job application sites.
 * Site-specific behaviour (LinkedIn Easy Apply modal flow, Greenhouse
 * single-page form, etc.) is provided via dynamic context — the caller
 * resolves site-specific supplemental instructions at runtime and injects
 * them into the request context under the `site-instructions` key.
 *
 * The base prompt lives at:
 *   `src/lib/mastra/prompts/job-application-agent/job-application-agent.md`
 *
 * Site-specific instruction supplements live at:
 *   `src/lib/mastra/prompts/job-application-agent/sites/{slug}.md`
 *
 * The agent receives the full application request context including:
 * - Application URL
 * - User profile (JSON)
 * - Job description text
 * - Resume data (JSON)
 * - Resume file path (for upload)
 * - Detected site name (e.g. "LinkedIn", "Greenhouse", "Generic")
 * - Site-specific instructions (loaded markdown supplement, or a generic fallback)
 *
 * @example
 * ```ts
 * import { RequestContext } from '@mastra/core/request-context';
 * import { resolveSiteInstructions } from './site-instructions';
 *
 * const agent = createJobApplicationAgent();
 * const { site, instructions } = resolveSiteInstructions(applicationUrl);
 *
 * const ctx = new RequestContext<JobApplicationRequestContext>();
 * ctx.set('application-url', applicationUrl);
 * ctx.set('user-profile', JSON.stringify(profileData));
 * ctx.set('job-description', jobDescriptionText);
 * ctx.set('resume-data', JSON.stringify(resumeData));
 * ctx.set('resume-file-path', '/path/to/resume.pdf');
 * ctx.set('detected-site', site);
 * ctx.set('site-instructions', instructions);
 *
 * const result = await agent.generate('Apply to this job posting.', {
 *   requestContext: ctx,
 *   maxSteps: 50,
 * });
 * ```
 */
export function createJobApplicationAgent(toolLogging?: ToolLoggingOptions) {
	return createAgent({
		id: 'job-application-agent',
		name: 'Job Application Agent',
		requestContextSchema: jobApplicationRequestContextSchema,
		dynamicContext: ({ requestContext }) => ({
			'Application URL': `\`${requestContext.get('application-url') as JobApplicationRequestContext['application-url']}\``,
			'Detected Site': requestContext.get(
				'detected-site'
			) as JobApplicationRequestContext['detected-site'],
			'User Profile': `\`\`\`json\n${requestContext.get('user-profile') as JobApplicationRequestContext['user-profile']}\n\`\`\``,
			'Job Description': `\`\`\`\n${requestContext.get('job-description') as JobApplicationRequestContext['job-description']}\n\`\`\``,
			'Resume Data': `\`\`\`json\n${requestContext.get('resume-data') as JobApplicationRequestContext['resume-data']}\n\`\`\``,
			'Resume File Path': `\`${requestContext.get('resume-file-path') as JobApplicationRequestContext['resume-file-path']}\``,
			'Site-Specific Instructions': requestContext.get(
				'site-instructions'
			) as JobApplicationRequestContext['site-instructions']
		}),
		model: ORCHESTRATOR_MODEL,
		tools: {
			...withToolLoggingAll(browserTools, toolLogging)
		}
	});
}
