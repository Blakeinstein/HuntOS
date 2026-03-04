import { env } from '$env/dynamic/private';
import { createAgent } from './create-agent';

export function createResumeAgent() {
	return createAgent({
		id: 'resume-agent',
		name: 'Resume Writer Agent',
		model: env.RESUME_AGENT_MODEL ?? 'openrouter/qwen/qwen3-30b-a3b-instruct-2507',
		dynamicContext: ({ requestContext }) => ({
			'Output Format Instructions': requestContext.get('format-instructions') ?? ''
		})
	});
}
