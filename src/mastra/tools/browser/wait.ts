// src/mastra/tools/browser/wait.ts
// Browser wait and element-finding tools

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { browserExec } from './exec';

export const waitForSelector = createTool({
	id: 'browser-wait-selector',
	description:
		'Wait for an element matching a CSS selector to appear on the page. ' +
		'Use this before interacting with elements that may take time to load.',
	inputSchema: z.object({
		selector: z
			.string()
			.describe('CSS selector or snapshot ref to wait for (e.g. ".results", "#login-form")')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string()
	}),
	execute: async ({ selector }) => {
		const result = await browserExec(['wait', selector], { timeout: 30_000 });
		return {
			success: result.success,
			message: result.success
				? `Element ${selector} appeared`
				: `Timed out waiting for ${selector}: ${result.stderr}`
		};
	}
});

export const waitForTime = createTool({
	id: 'browser-wait-time',
	description:
		'Wait for a specified number of milliseconds. ' +
		'Use this to add a delay, e.g. waiting for animations, debounced inputs, or API calls.',
	inputSchema: z.object({
		ms: z
			.number()
			.min(0)
			.max(30000)
			.describe('Number of milliseconds to wait (max 30000)')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string()
	}),
	execute: async ({ ms }) => {
		const result = await browserExec(['wait', String(ms)], { timeout: ms + 5000 });
		return {
			success: result.success,
			message: result.success
				? `Waited ${ms}ms`
				: `Wait failed: ${result.stderr}`
		};
	}
});

export const waitForText = createTool({
	id: 'browser-wait-text',
	description:
		'Wait for specific text to appear anywhere on the page. ' +
		'Use this to confirm a page has loaded, a form submitted, or content appeared.',
	inputSchema: z.object({
		text: z
			.string()
			.describe('The text to wait for on the page (e.g. "Welcome", "Results found")')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string()
	}),
	execute: async ({ text }) => {
		const result = await browserExec(['wait', '--text', text], { timeout: 30_000 });
		return {
			success: result.success,
			message: result.success
				? `Text "${text}" appeared on page`
				: `Timed out waiting for text "${text}": ${result.stderr}`
		};
	}
});

export const waitForUrl = createTool({
	id: 'browser-wait-url',
	description:
		'Wait for the page URL to match a pattern. ' +
		'Use glob patterns like "**/dashboard" or "**/login". ' +
		'Useful for waiting after navigation, form submission, or redirects.',
	inputSchema: z.object({
		urlPattern: z
			.string()
			.describe('URL glob pattern to wait for (e.g. "**/dashboard", "**/search?q=*")')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string()
	}),
	execute: async ({ urlPattern }) => {
		const result = await browserExec(['wait', '--url', urlPattern], { timeout: 30_000 });
		return {
			success: result.success,
			message: result.success
				? `URL matched pattern "${urlPattern}"`
				: `Timed out waiting for URL "${urlPattern}": ${result.stderr}`
		};
	}
});

export const waitForLoad = createTool({
	id: 'browser-wait-load',
	description:
		'Wait for a specific page load state. ' +
		'Use "networkidle" to wait until no network requests are in-flight (good for SPAs). ' +
		'Use "load" for standard page load, "domcontentloaded" for DOM ready.',
	inputSchema: z.object({
		state: z
			.enum(['load', 'domcontentloaded', 'networkidle'])
			.describe('The load state to wait for')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string()
	}),
	execute: async ({ state }) => {
		const result = await browserExec(['wait', '--load', state], { timeout: 30_000 });
		return {
			success: result.success,
			message: result.success
				? `Page reached "${state}" state`
				: `Timed out waiting for "${state}": ${result.stderr}`
		};
	}
});

export const waitForCondition = createTool({
	id: 'browser-wait-condition',
	description:
		'Wait for a JavaScript condition to become truthy. ' +
		'The condition is evaluated in the page context repeatedly until it returns a truthy value. ' +
		'Example: "document.querySelectorAll(\'.result\').length > 0"',
	inputSchema: z.object({
		condition: z
			.string()
			.describe(
				'JavaScript expression that should evaluate to truthy when the wait condition is met'
			)
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string()
	}),
	execute: async ({ condition }) => {
		const result = await browserExec(['wait', '--fn', condition], { timeout: 30_000 });
		return {
			success: result.success,
			message: result.success
				? `Condition met: ${condition}`
				: `Timed out waiting for condition: ${result.stderr}`
		};
	}
});

// ---------------------------------------------------------------------------
// Semantic element finding with actions
// ---------------------------------------------------------------------------

const findActionSchema = z
	.enum(['click', 'fill', 'check', 'hover', 'text'])
	.describe('Action to perform on the found element');

export const findByRole = createTool({
	id: 'browser-find-role',
	description:
		'Find an element by its ARIA role and perform an action on it. ' +
		'Optionally filter by accessible name. ' +
		'Examples: find a button named "Submit", a link named "Sign In", a textbox named "Email". ' +
		'Common roles: button, link, textbox, checkbox, radio, heading, dialog, tab, menuitem.',
	inputSchema: z.object({
		role: z
			.string()
			.describe('ARIA role (e.g. "button", "link", "textbox", "checkbox", "heading")'),
		action: findActionSchema,
		name: z
			.string()
			.optional()
			.describe('Accessible name to filter by (e.g. "Submit", "Email")'),
		value: z
			.string()
			.optional()
			.describe('Value for "fill" action — the text to type into the element')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string(),
		output: z.string()
	}),
	execute: async ({ role, action, name, value }) => {
		const args = ['find', 'role', role, action];
		if (value) args.push(value);
		if (name) args.push('--name', name);

		const result = await browserExec(args);
		return {
			success: result.success,
			message: result.success
				? `Found ${role}${name ? ` "${name}"` : ''} and performed ${action}`
				: `Failed: ${result.stderr}`,
			output: result.stdout
		};
	}
});

export const findByText = createTool({
	id: 'browser-find-text',
	description:
		'Find an element by its visible text content and perform an action on it. ' +
		'Use this when you know the exact text displayed on the element.',
	inputSchema: z.object({
		text: z.string().describe('The visible text to search for'),
		action: findActionSchema,
		value: z
			.string()
			.optional()
			.describe('Value for "fill" action')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string(),
		output: z.string()
	}),
	execute: async ({ text, action, value }) => {
		const args = ['find', 'text', text, action];
		if (value) args.push(value);

		const result = await browserExec(args);
		return {
			success: result.success,
			message: result.success
				? `Found element with text "${text}" and performed ${action}`
				: `Failed: ${result.stderr}`,
			output: result.stdout
		};
	}
});

export const findByLabel = createTool({
	id: 'browser-find-label',
	description:
		'Find an element by its associated label text and perform an action. ' +
		'Great for form fields — e.g. find the input labelled "Email" and fill it.',
	inputSchema: z.object({
		label: z
			.string()
			.describe('The label text associated with the element (e.g. "Email", "Password")'),
		action: findActionSchema,
		value: z
			.string()
			.optional()
			.describe('Value for "fill" action — the text to enter')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string(),
		output: z.string()
	}),
	execute: async ({ label, action, value }) => {
		const args = ['find', 'label', label, action];
		if (value) args.push(value);

		const result = await browserExec(args);
		return {
			success: result.success,
			message: result.success
				? `Found element labelled "${label}" and performed ${action}`
				: `Failed: ${result.stderr}`,
			output: result.stdout
		};
	}
});

export const findByPlaceholder = createTool({
	id: 'browser-find-placeholder',
	description:
		'Find an input element by its placeholder text and perform an action. ' +
		'Useful when form fields have placeholder text but no visible label.',
	inputSchema: z.object({
		placeholder: z
			.string()
			.describe('The placeholder text of the input (e.g. "Search...", "Enter your email")'),
		action: findActionSchema,
		value: z
			.string()
			.optional()
			.describe('Value for "fill" action')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string(),
		output: z.string()
	}),
	execute: async ({ placeholder, action, value }) => {
		const args = ['find', 'placeholder', placeholder, action];
		if (value) args.push(value);

		const result = await browserExec(args);
		return {
			success: result.success,
			message: result.success
				? `Found element with placeholder "${placeholder}" and performed ${action}`
				: `Failed: ${result.stderr}`,
			output: result.stdout
		};
	}
});

export const findByTestId = createTool({
	id: 'browser-find-testid',
	description:
		'Find an element by its data-testid attribute and perform an action. ' +
		'Use when elements have data-testid attributes for automation.',
	inputSchema: z.object({
		testId: z
			.string()
			.describe('The data-testid value (e.g. "submit-button", "email-input")'),
		action: findActionSchema,
		value: z
			.string()
			.optional()
			.describe('Value for "fill" action')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string(),
		output: z.string()
	}),
	execute: async ({ testId, action, value }) => {
		const args = ['find', 'testid', testId, action];
		if (value) args.push(value);

		const result = await browserExec(args);
		return {
			success: result.success,
			message: result.success
				? `Found element with testid "${testId}" and performed ${action}`
				: `Failed: ${result.stderr}`,
			output: result.stdout
		};
	}
});

export const findFirst = createTool({
	id: 'browser-find-first',
	description:
		'Find the first element matching a CSS selector and perform an action on it. ' +
		'Useful when there are multiple matching elements and you want the first one.',
	inputSchema: z.object({
		selector: z
			.string()
			.describe('CSS selector (e.g. ".job-card", "a.apply-link")'),
		action: findActionSchema,
		value: z
			.string()
			.optional()
			.describe('Value for "fill" action')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string(),
		output: z.string()
	}),
	execute: async ({ selector, action, value }) => {
		const args = ['find', 'first', selector, action];
		if (value) args.push(value);

		const result = await browserExec(args);
		return {
			success: result.success,
			message: result.success
				? `Found first "${selector}" and performed ${action}`
				: `Failed: ${result.stderr}`,
			output: result.stdout
		};
	}
});

export const findNth = createTool({
	id: 'browser-find-nth',
	description:
		'Find the nth element (0-based index) matching a CSS selector and perform an action. ' +
		'Use this to target a specific item in a list of matching elements.',
	inputSchema: z.object({
		index: z
			.number()
			.min(0)
			.describe('Zero-based index of the element to target'),
		selector: z
			.string()
			.describe('CSS selector (e.g. ".job-card", "li.result")'),
		action: findActionSchema,
		value: z
			.string()
			.optional()
			.describe('Value for "fill" action')
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string(),
		output: z.string()
	}),
	execute: async ({ index, selector, action, value }) => {
		const args = ['find', 'nth', String(index), selector, action];
		if (value) args.push(value);

		const result = await browserExec(args);
		return {
			success: result.success,
			message: result.success
				? `Found element #${index} of "${selector}" and performed ${action}`
				: `Failed: ${result.stderr}`,
			output: result.stdout
		};
	}
});
