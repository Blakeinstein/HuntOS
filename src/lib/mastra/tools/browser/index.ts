// src/lib/mastra/tools/browser/index.ts
// Barrel file — re-exports all browser tools as a flat record for agent consumption

import {
	openUrl,
	goBack,
	goForward,
	reload,
	closeBrowser,
	snapshot,
	screenshot,
	getTitle,
	getUrl,
	scroll
} from './navigation';

import {
	click,
	dblclick,
	fill,
	type,
	press,
	hover,
	select,
	check,
	uncheck
} from './interaction';

import {
	getText,
	getHtml,
	getValue,
	getAttribute,
	getCount,
	getBoundingBox,
	isVisible,
	isEnabled,
	isChecked,
	evalJs
} from './extraction';

import {
	waitForSelector,
	waitForTime,
	waitForText,
	waitForUrl,
	waitForLoad,
	waitForCondition,
	findByRole,
	findByText,
	findByLabel,
	findByPlaceholder,
	findByTestId,
	findFirst,
	findNth
} from './wait';

import {
	listTabs,
	newTab,
	switchTab,
	closeTab,
	switchToFrame,
	switchToMainFrame
} from './tabs';

// Individual exports for selective usage
export {
	// Navigation
	openUrl,
	goBack,
	goForward,
	reload,
	closeBrowser,
	snapshot,
	screenshot,
	getTitle,
	getUrl,
	scroll,
	// Interaction
	click,
	dblclick,
	fill,
	type,
	press,
	hover,
	select,
	check,
	uncheck,
	// Extraction
	getText,
	getHtml,
	getValue,
	getAttribute,
	getCount,
	getBoundingBox,
	isVisible,
	isEnabled,
	isChecked,
	evalJs,
	// Wait & Find
	waitForSelector,
	waitForTime,
	waitForText,
	waitForUrl,
	waitForLoad,
	waitForCondition,
	findByRole,
	findByText,
	findByLabel,
	findByPlaceholder,
	findByTestId,
	findFirst,
	findNth,
	// Tabs & Frames
	listTabs,
	newTab,
	switchTab,
	closeTab,
	switchToFrame,
	switchToMainFrame
};

/**
 * All browser tools as a flat record, ready to spread into an agent's `tools` config.
 *
 * @example
 * ```ts
 * import { browserTools } from '../tools/browser';
 *
 * const agent = createAgent({
 *   id: 'browser-agent',
 *   tools: { ...browserTools },
 * });
 * ```
 */
export const browserTools = {
	// Navigation
	openUrl,
	goBack,
	goForward,
	reload,
	closeBrowser,
	snapshot,
	screenshot,
	getTitle,
	getUrl,
	scroll,
	// Interaction
	click,
	dblclick,
	fill,
	type,
	press,
	hover,
	select,
	check,
	uncheck,
	// Extraction
	getText,
	getHtml,
	getValue,
	getAttribute,
	getCount,
	getBoundingBox,
	isVisible,
	isEnabled,
	isChecked,
	evalJs,
	// Wait & Find
	waitForSelector,
	waitForTime,
	waitForText,
	waitForUrl,
	waitForLoad,
	waitForCondition,
	findByRole,
	findByText,
	findByLabel,
	findByPlaceholder,
	findByTestId,
	findFirst,
	findNth,
	// Tabs & Frames
	listTabs,
	newTab,
	switchTab,
	closeTab,
	switchToFrame,
	switchToMainFrame
} as const;
