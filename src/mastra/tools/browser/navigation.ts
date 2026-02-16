// src/mastra/tools/browser/navigation.ts
// Browser navigation tools — open, back, forward, reload, close, snapshot, screenshot

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { browserExec } from './exec';

export const openUrl = createTool({
	id: 'browser-open',
	description:
		'Navigate the browser to a URL. Use this to visit websites, job boards, or any web page. ' +
		'Aliases: goto, navigate.',
	inputSchema: z.object({
		url: z.string().describe('The URL to navigate to (e.g. "https://example.com")')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string()
	}),
	execute: async ({ url }) => {
		const result = await browserExec(['open', url]);
		return {
			success: result.success,
			message: result.success
				? `Navigated to ${url}`
				: `Failed to navigate: ${result.stderr}`
		};
	}
});

export const goBack = createTool({
	id: 'browser-back',
	description: 'Go back to the previous page in browser history.',
	inputSchema: z.object({}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string()
	}),
	execute: async () => {
		const result = await browserExec(['back']);
		return {
			success: result.success,
			message: result.success ? 'Navigated back' : `Failed: ${result.stderr}`
		};
	}
});

export const goForward = createTool({
	id: 'browser-forward',
	description: 'Go forward to the next page in browser history.',
	inputSchema: z.object({}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string()
	}),
	execute: async () => {
		const result = await browserExec(['forward']);
		return {
			success: result.success,
			message: result.success ? 'Navigated forward' : `Failed: ${result.stderr}`
		};
	}
});

export const reload = createTool({
	id: 'browser-reload',
	description: 'Reload the current page.',
	inputSchema: z.object({}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string()
	}),
	execute: async () => {
		const result = await browserExec(['reload']);
		return {
			success: result.success,
			message: result.success ? 'Page reloaded' : `Failed: ${result.stderr}`
		};
	}
});

export const closeBrowser = createTool({
	id: 'browser-close',
	description: 'Close the browser session.',
	inputSchema: z.object({}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string()
	}),
	execute: async () => {
		const result = await browserExec(['close']);
		return {
			success: result.success,
			message: result.success ? 'Browser closed' : `Failed: ${result.stderr}`
		};
	}
});

export const snapshot = createTool({
	id: 'browser-snapshot',
	description:
		'Get the accessibility tree of the current page with element refs. ' +
		'This is the primary way to "see" the page and discover interactive elements. ' +
		'Each element gets a ref like @e1, @e2 which can be used in click, fill, etc. ' +
		'Use --interactive to only show interactive elements, --compact to remove empty structural elements.',
	inputSchema: z.object({
		interactive: z
			.boolean()
			.optional()
			.default(false)
			.describe('Only show interactive elements (buttons, inputs, links, etc.)'),
		compact: z
			.boolean()
			.optional()
			.default(false)
			.describe('Remove empty structural elements for a cleaner tree'),
		selector: z
			.string()
			.optional()
			.describe('Scope the snapshot to a CSS selector'),
		depth: z
			.number()
			.optional()
			.describe('Limit tree depth')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		snapshot: z.string()
	}),
	execute: async ({ interactive, compact, selector, depth }) => {
		const args = ['snapshot'];
		if (interactive) args.push('-i');
		if (compact) args.push('-c');
		if (depth !== undefined) args.push('-d', String(depth));
		if (selector) args.push('-s', selector);

		const result = await browserExec(args, { timeout: 15_000 });
		return {
			success: result.success,
			snapshot: result.success ? result.stdout : `Failed: ${result.stderr}`
		};
	}
});

export const screenshot = createTool({
	id: 'browser-screenshot',
	description:
		'Take a screenshot of the current page. Optionally save to a file path. ' +
		'Use fullPage to capture the entire scrollable page.',
	inputSchema: z.object({
		path: z
			.string()
			.optional()
			.describe('File path to save the screenshot to (e.g. "screenshot.png")'),
		fullPage: z
			.boolean()
			.optional()
			.default(false)
			.describe('Capture the full scrollable page instead of just the viewport')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string(),
		output: z.string()
	}),
	execute: async ({ path, fullPage }) => {
		const args = ['screenshot'];
		if (fullPage) args.push('--full');
		if (path) args.push(path);

		const result = await browserExec(args, { timeout: 15_000 });
		return {
			success: result.success,
			message: result.success ? 'Screenshot taken' : `Failed: ${result.stderr}`,
			output: result.stdout
		};
	}
});

export const getTitle = createTool({
	id: 'browser-get-title',
	description: 'Get the title of the current page.',
	inputSchema: z.object({}),
	outputSchema: z.object({
		success: z.boolean(),
		title: z.string()
	}),
	execute: async () => {
		const result = await browserExec(['get', 'title']);
		return {
			success: result.success,
			title: result.success ? result.stdout : `Failed: ${result.stderr}`
		};
	}
});

export const getUrl = createTool({
	id: 'browser-get-url',
	description: 'Get the current URL of the page.',
	inputSchema: z.object({}),
	outputSchema: z.object({
		success: z.boolean(),
		url: z.string()
	}),
	execute: async () => {
		const result = await browserExec(['get', 'url']);
		return {
			success: result.success,
			url: result.success ? result.stdout : `Failed: ${result.stderr}`
		};
	}
});

export const scroll = createTool({
	id: 'browser-scroll',
	description: 'Scroll the page in a given direction.',
	inputSchema: z.object({
		direction: z
			.enum(['up', 'down', 'left', 'right'])
			.describe('Direction to scroll'),
		pixels: z
			.number()
			.optional()
			.describe('Number of pixels to scroll (defaults to a reasonable amount)')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string()
	}),
	execute: async ({ direction, pixels }) => {
		const args = ['scroll', direction];
		if (pixels !== undefined) args.push(String(pixels));

		const result = await browserExec(args);
		return {
			success: result.success,
			message: result.success
				? `Scrolled ${direction}${pixels ? ` ${pixels}px` : ''}`
				: `Failed: ${result.stderr}`
		};
	}
});
