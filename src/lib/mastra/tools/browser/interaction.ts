// src/lib/mastra/tools/browser/interaction.ts
// Browser interaction tools — click, fill, type, press, hover, select, check, uncheck, upload

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { browserExec } from './exec';

export const click = createTool({
	id: 'browser-click',
	description:
		'Click an element on the page. Use a CSS selector or a snapshot ref (e.g. @e1). ' +
		'Always take a snapshot first to discover available element refs.',
	inputSchema: z.object({
		selector: z
			.string()
			.describe('CSS selector or snapshot ref (e.g. "@e1", "button.submit", "#login")')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string()
	}),
	execute: async ({ selector }) => {
		const result = await browserExec(['click', selector]);
		return {
			success: result.success,
			message: result.success
				? `Clicked ${selector}`
				: `Failed to click ${selector}: ${result.stderr}`
		};
	}
});

export const dblclick = createTool({
	id: 'browser-dblclick',
	description: 'Double-click an element on the page.',
	inputSchema: z.object({
		selector: z.string().describe('CSS selector or snapshot ref (e.g. "@e1")')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string()
	}),
	execute: async ({ selector }) => {
		const result = await browserExec(['dblclick', selector]);
		return {
			success: result.success,
			message: result.success
				? `Double-clicked ${selector}`
				: `Failed to double-click ${selector}: ${result.stderr}`
		};
	}
});

export const fill = createTool({
	id: 'browser-fill',
	description:
		'Clear an input field and fill it with new text. ' +
		'Use this for form fields like name, email, search boxes, etc. ' +
		'This clears existing content first, unlike "type" which appends.',
	inputSchema: z.object({
		selector: z
			.string()
			.describe('CSS selector or snapshot ref of the input element (e.g. "@e3", "#email")'),
		text: z.string().describe('The text to fill into the field')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string()
	}),
	execute: async ({ selector, text }) => {
		const result = await browserExec(['fill', selector, text]);
		return {
			success: result.success,
			message: result.success
				? `Filled ${selector} with "${text}"`
				: `Failed to fill ${selector}: ${result.stderr}`
		};
	}
});

export const type = createTool({
	id: 'browser-type',
	description:
		'Type text into an element without clearing it first. ' +
		'Use this when you want to append text or simulate real typing. ' +
		'For clearing and replacing, use "fill" instead.',
	inputSchema: z.object({
		selector: z.string().describe('CSS selector or snapshot ref of the input element'),
		text: z.string().describe('The text to type')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string()
	}),
	execute: async ({ selector, text }) => {
		const result = await browserExec(['type', selector, text]);
		return {
			success: result.success,
			message: result.success
				? `Typed "${text}" into ${selector}`
				: `Failed to type into ${selector}: ${result.stderr}`
		};
	}
});

export const press = createTool({
	id: 'browser-press',
	description:
		'Press a keyboard key. Use for Enter, Tab, Escape, arrow keys, or key combos like "Control+a". ' +
		'Common keys: Enter, Tab, Escape, Backspace, ArrowUp, ArrowDown, Control+a, Control+c, Control+v.',
	inputSchema: z.object({
		key: z.string().describe('Key to press (e.g. "Enter", "Tab", "Escape", "Control+a")')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string()
	}),
	execute: async ({ key }) => {
		const result = await browserExec(['press', key]);
		return {
			success: result.success,
			message: result.success ? `Pressed ${key}` : `Failed to press ${key}: ${result.stderr}`
		};
	}
});

export const hover = createTool({
	id: 'browser-hover',
	description:
		'Hover over an element. Use this to trigger hover menus, tooltips, or dropdown reveals.',
	inputSchema: z.object({
		selector: z.string().describe('CSS selector or snapshot ref of the element to hover')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string()
	}),
	execute: async ({ selector }) => {
		const result = await browserExec(['hover', selector]);
		return {
			success: result.success,
			message: result.success
				? `Hovered over ${selector}`
				: `Failed to hover ${selector}: ${result.stderr}`
		};
	}
});

export const select = createTool({
	id: 'browser-select',
	description:
		'Select an option from a dropdown (<select>) element. ' +
		'Provide the value of the option to select.',
	inputSchema: z.object({
		selector: z.string().describe('CSS selector or snapshot ref of the <select> element'),
		value: z.string().describe('The value of the option to select')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string()
	}),
	execute: async ({ selector, value }) => {
		const result = await browserExec(['select', selector, value]);
		return {
			success: result.success,
			message: result.success
				? `Selected "${value}" in ${selector}`
				: `Failed to select in ${selector}: ${result.stderr}`
		};
	}
});

export const check = createTool({
	id: 'browser-check',
	description: 'Check a checkbox element (set it to checked/true).',
	inputSchema: z.object({
		selector: z.string().describe('CSS selector or snapshot ref of the checkbox')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string()
	}),
	execute: async ({ selector }) => {
		const result = await browserExec(['check', selector]);
		return {
			success: result.success,
			message: result.success
				? `Checked ${selector}`
				: `Failed to check ${selector}: ${result.stderr}`
		};
	}
});

export const uncheck = createTool({
	id: 'browser-uncheck',
	description: 'Uncheck a checkbox element (set it to unchecked/false).',
	inputSchema: z.object({
		selector: z.string().describe('CSS selector or snapshot ref of the checkbox')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string()
	}),
	execute: async ({ selector }) => {
		const result = await browserExec(['uncheck', selector]);
		return {
			success: result.success,
			message: result.success
				? `Unchecked ${selector}`
				: `Failed to uncheck ${selector}: ${result.stderr}`
		};
	}
});

export const uploadFile = createTool({
	id: 'browser-upload',
	description:
		'Upload one or more files via a file input element WITHOUT opening the OS file picker dialog. ' +
		'Use this instead of browser-fill or browser-click for ANY file upload input. ' +
		'The selector should target the upload button, drop zone, or file input. ' +
		'Pass the absolute file path(s) as a comma-separated string for multiple files. ' +
		'This is the ONLY correct way to upload files — never use browser-click on upload buttons ' +
		'as that opens a native file picker the agent cannot interact with.',
	inputSchema: z.object({
		selector: z
			.string()
			.describe(
				'CSS selector or snapshot ref of the file upload button, drop zone, or input[type="file"] element (e.g. "@e5", "input[type=\'file\']", ".upload-button")'
			),
		files: z
			.string()
			.describe(
				'Absolute path to the file to upload. For multiple files, separate paths with a comma (e.g. "/path/a.pdf,/path/b.pdf")'
			)
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string()
	}),
	execute: async ({ selector, files }) => {
		const result = await browserExec(['upload', selector, files], { timeout: 60_000 });
		return {
			success: result.success,
			message: result.success
				? `Uploaded file(s) "${files}" via ${selector}`
				: `Failed to upload file(s) via ${selector}: ${result.stderr}`
		};
	}
});
