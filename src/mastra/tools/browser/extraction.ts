// src/mastra/tools/browser/extraction.ts
// Browser data extraction tools — get text, html, value, attribute, count, bounding box, state checks

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { browserExec } from './exec';

export const getText = createTool({
	id: 'browser-get-text',
	description:
		'Get the text content of an element. Use this to read visible text from any element on the page.',
	inputSchema: z.object({
		selector: z
			.string()
			.describe('CSS selector or snapshot ref (e.g. "@e1", ".job-title", "#description")')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		text: z.string()
	}),
	execute: async ({ selector }) => {
		const result = await browserExec(['get', 'text', selector]);
		return {
			success: result.success,
			text: result.success ? result.stdout : `Failed: ${result.stderr}`
		};
	}
});

export const getHtml = createTool({
	id: 'browser-get-html',
	description:
		'Get the innerHTML of an element. Use this to inspect the raw HTML structure of a section of the page.',
	inputSchema: z.object({
		selector: z
			.string()
			.describe('CSS selector or snapshot ref (e.g. "@e1", ".container")')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		html: z.string()
	}),
	execute: async ({ selector }) => {
		const result = await browserExec(['get', 'html', selector]);
		return {
			success: result.success,
			html: result.success ? result.stdout : `Failed: ${result.stderr}`
		};
	}
});

export const getValue = createTool({
	id: 'browser-get-value',
	description:
		'Get the current value of an input, textarea, or select element. ' +
		'Use this to verify what has been filled into a form field.',
	inputSchema: z.object({
		selector: z
			.string()
			.describe('CSS selector or snapshot ref of the input element')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		value: z.string()
	}),
	execute: async ({ selector }) => {
		const result = await browserExec(['get', 'value', selector]);
		return {
			success: result.success,
			value: result.success ? result.stdout : `Failed: ${result.stderr}`
		};
	}
});

export const getAttribute = createTool({
	id: 'browser-get-attribute',
	description:
		'Get a specific HTML attribute of an element (e.g. href, src, class, data-*, aria-*).',
	inputSchema: z.object({
		selector: z
			.string()
			.describe('CSS selector or snapshot ref of the element'),
		attribute: z
			.string()
			.describe('The attribute name to retrieve (e.g. "href", "src", "aria-label")')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		value: z.string()
	}),
	execute: async ({ selector, attribute }) => {
		const result = await browserExec(['get', 'attr', selector, attribute]);
		return {
			success: result.success,
			value: result.success ? result.stdout : `Failed: ${result.stderr}`
		};
	}
});

export const getCount = createTool({
	id: 'browser-get-count',
	description:
		'Count the number of elements matching a CSS selector. ' +
		'Useful for checking how many results, list items, or matching elements exist on the page.',
	inputSchema: z.object({
		selector: z
			.string()
			.describe('CSS selector to count matches for (e.g. ".job-card", "li.result")')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		count: z.number()
	}),
	execute: async ({ selector }) => {
		const result = await browserExec(['get', 'count', selector]);
		const count = result.success ? parseInt(result.stdout, 10) : 0;
		return {
			success: result.success,
			count: isNaN(count) ? 0 : count
		};
	}
});

export const getBoundingBox = createTool({
	id: 'browser-get-box',
	description:
		'Get the bounding box (position and size) of an element. ' +
		'Returns x, y, width, and height coordinates.',
	inputSchema: z.object({
		selector: z
			.string()
			.describe('CSS selector or snapshot ref of the element')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		box: z.string()
	}),
	execute: async ({ selector }) => {
		const result = await browserExec(['get', 'box', selector]);
		return {
			success: result.success,
			box: result.success ? result.stdout : `Failed: ${result.stderr}`
		};
	}
});

export const isVisible = createTool({
	id: 'browser-is-visible',
	description: 'Check if an element is visible on the page.',
	inputSchema: z.object({
		selector: z
			.string()
			.describe('CSS selector or snapshot ref of the element to check')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		visible: z.boolean()
	}),
	execute: async ({ selector }) => {
		const result = await browserExec(['is', 'visible', selector]);
		const visible = result.success && result.stdout.toLowerCase().includes('true');
		return {
			success: result.success,
			visible
		};
	}
});

export const isEnabled = createTool({
	id: 'browser-is-enabled',
	description:
		'Check if an element is enabled (not disabled). ' +
		'Useful for checking if a submit button is clickable.',
	inputSchema: z.object({
		selector: z
			.string()
			.describe('CSS selector or snapshot ref of the element to check')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		enabled: z.boolean()
	}),
	execute: async ({ selector }) => {
		const result = await browserExec(['is', 'enabled', selector]);
		const enabled = result.success && result.stdout.toLowerCase().includes('true');
		return {
			success: result.success,
			enabled
		};
	}
});

export const isChecked = createTool({
	id: 'browser-is-checked',
	description: 'Check if a checkbox or radio button is currently checked.',
	inputSchema: z.object({
		selector: z
			.string()
			.describe('CSS selector or snapshot ref of the checkbox/radio to check')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		checked: z.boolean()
	}),
	execute: async ({ selector }) => {
		const result = await browserExec(['is', 'checked', selector]);
		const checked = result.success && result.stdout.toLowerCase().includes('true');
		return {
			success: result.success,
			checked
		};
	}
});

export const evalJs = createTool({
	id: 'browser-eval',
	description:
		'Run arbitrary JavaScript in the browser page context and return the result. ' +
		'Use this for advanced data extraction or page manipulation that other tools cannot handle.',
	inputSchema: z.object({
		script: z
			.string()
			.describe('JavaScript expression or code to evaluate in the page context')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		result: z.string()
	}),
	execute: async ({ script }) => {
		const result = await browserExec(['eval', script], { timeout: 15_000 });
		return {
			success: result.success,
			result: result.success ? result.stdout : `Failed: ${result.stderr}`
		};
	}
});
