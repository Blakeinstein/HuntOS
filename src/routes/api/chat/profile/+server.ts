// src/routes/api/chat/profile/+server.ts
// Chat API endpoint for the profile builder agent

import type { RequestHandler } from './$types';
import { handleChatStream } from '@mastra/ai-sdk';
import { toAISdkV5Messages } from '@mastra/ai-sdk/ui';
import { createUIMessageStreamResponse } from 'ai';
import { mastra } from '$lib/mastra';

const THREAD_ID = 'profile-builder';
const RESOURCE_ID = 'profile-chat';

export const POST: RequestHandler = async ({ request }) => {
	const params = await request.json();

	const stream = await handleChatStream({
		mastra,
		agentId: 'profile-agent',
		params: {
			...params,
			memory: {
				...params.memory,
				thread: THREAD_ID,
				resource: RESOURCE_ID
			}
		}
	});

	return createUIMessageStreamResponse({ stream });
};

export const GET: RequestHandler = async () => {
	const memory = await mastra.getAgentById('profile-agent').getMemory();
	let response = null;

	try {
		response = await memory?.recall({
			threadId: THREAD_ID,
			resourceId: RESOURCE_ID
		});
	} catch {
		console.log('No previous profile chat messages found.');
	}

	const uiMessages = toAISdkV5Messages(response?.messages || []);
	return Response.json(uiMessages);
};
