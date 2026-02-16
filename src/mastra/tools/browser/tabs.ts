// src/mastra/tools/browser/tabs.ts
// Browser tab management tools — list, new, switch, close, frame switching

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { browserExec } from './exec';

export const listTabs = createTool({
	id: 'browser-tab-list',
	description:
		'List all open browser tabs. Shows tab index, URL, and title for each tab. ' +
		'Use this to see what tabs are open before switching or closing.',
	inputSchema: z.object({}),
	outputSchema: z.object({
		success: z.boolean(),
		tabs: z.string()
	}),
	execute: async () => {
		const result = await browserExec(['tab']);
		return {
			success: result.success,
			tabs: result.success ? result.stdout : `Failed: ${result.stderr}`
		};
	}
});

export const newTab = createTool({
	id: 'browser-tab-new',
	description:
		'Open a new browser tab. Optionally navigate it to a URL immediately. ' +
		'The new tab becomes the active tab.',
	inputSchema: z.object({
		url: z
			.string()
			.optional()
			.describe('Optional URL to open in the new tab (e.g. "https://example.com")')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string()
	}),
	execute: async ({ url }) => {
		const args = ['tab', 'new'];
		if (url) args.push(url);

		const result = await browserExec(args);
		return {
			success: result.success,
			message: result.success
				? `Opened new tab${url ? ` at ${url}` : ''}`
				: `Failed to open new tab: ${result.stderr}`
		};
	}
});

export const switchTab = createTool({
	id: 'browser-tab-switch',
	description:
		'Switch to a specific browser tab by its index (0-based). ' +
		'Use "browser-tab-list" first to see available tabs and their indices.',
	inputSchema: z.object({
		index: z
			.number()
			.min(0)
			.describe('Zero-based index of the tab to switch to')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string()
	}),
	execute: async ({ index }) => {
		const result = await browserExec(['tab', String(index)]);
		return {
			success: result.success,
			message: result.success
				? `Switched to tab ${index}`
				: `Failed to switch to tab ${index}: ${result.stderr}`
		};
	}
});

export const closeTab = createTool({
	id: 'browser-tab-close',
	description:
		'Close a browser tab. If no index is provided, closes the current tab. ' +
		'Otherwise closes the tab at the specified index.',
	inputSchema: z.object({
		index: z
			.number()
			.min(0)
			.optional()
			.describe('Zero-based index of the tab to close. Omit to close the current tab.')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string()
	}),
	execute: async ({ index }) => {
		const args = ['tab', 'close'];
		if (index !== undefined) args.push(String(index));

		const result = await browserExec(args);
		return {
			success: result.success,
			message: result.success
				? `Closed tab${index !== undefined ? ` ${index}` : ' (current)'}`
				: `Failed to close tab: ${result.stderr}`
		};
	}
});

export const switchToFrame = createTool({
	id: 'browser-frame-switch',
	description:
		'Switch the browser context into an iframe. ' +
		'Some pages embed forms or content inside iframes — you must switch into the frame ' +
		'before you can interact with elements inside it. ' +
		'Provide a CSS selector that targets the <iframe> element.',
	inputSchema: z.object({
		selector: z
			.string()
			.describe('CSS selector of the <iframe> element to switch into (e.g. "iframe#form", "iframe[name=\\"apply\\"]")')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string()
	}),
	execute: async ({ selector }) => {
		const result = await browserExec(['frame', selector]);
		return {
			success: result.success,
			message: result.success
				? `Switched to frame ${selector}`
				: `Failed to switch to frame ${selector}: ${result.stderr}`
		};
	}
});

export const switchToMainFrame = createTool({
	id: 'browser-frame-main',
	description:
		'Switch back to the main page frame after working inside an iframe. ' +
		'Always call this after you are done interacting with elements inside an iframe.',
	inputSchema: z.object({}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string()
	}),
	execute: async () => {
		const result = await browserExec(['frame', 'main']);
		return {
			success: result.success,
			message: result.success
				? 'Switched back to main frame'
				: `Failed to switch to main frame: ${result.stderr}`
		};
	}
});
