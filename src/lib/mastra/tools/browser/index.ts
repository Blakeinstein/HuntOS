// src/lib/mastra/tools/browser/index.ts
// Barrel file — re-exports all browser tools as a flat record for agent consumption
//
// IMPORTANT: The keys in `browserTools` are the names the LLM sees and calls.
// Mastra registers these keys as tool names with the AI SDK. When the LLM emits
// a tool call, Mastra looks up `tools[toolName]`. OpenAI-compatible APIs (including
// OpenRouter) normalise tool names by replacing hyphens with underscores, so a tool
// registered as "browser-wait-load" would be called as "browser_wait_load" by the
// model — which would not match the key.
//
// Solution: use underscore-separated keys here that exactly match what the LLM will
// emit, and update all prompt Tool Reference tables to use the same underscore names.

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
	uncheck,
	uploadFile
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

import { listTabs, newTab, switchTab, closeTab, switchToFrame, switchToMainFrame } from './tabs';

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
	uploadFile,
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
 * Keys use the exact underscore_separated names the LLM will emit in tool calls.
 * OpenAI-compatible APIs (OpenRouter, Anthropic, etc.) normalise hyphens → underscores
 * in function names, so "browser-wait-load" becomes "browser_wait_load" in the
 * model's response. Using underscore keys here ensures `tools[toolName]` resolves
 * correctly without falling back to the slower `.id` scan.
 *
 * Each tool's `.id` field still uses hyphens (e.g. `browser-wait-load`) for logging
 * and audit purposes — only the registration key changes.
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
	browser_open: openUrl,
	browser_back: goBack,
	browser_forward: goForward,
	browser_reload: reload,
	browser_close: closeBrowser,
	browser_snapshot: snapshot,
	browser_screenshot: screenshot,
	browser_get_title: getTitle,
	browser_get_url: getUrl,
	browser_scroll: scroll,
	// Interaction
	browser_click: click,
	browser_dblclick: dblclick,
	browser_fill: fill,
	browser_type: type,
	browser_press: press,
	browser_hover: hover,
	browser_select: select,
	browser_check: check,
	browser_uncheck: uncheck,
	browser_upload: uploadFile,
	// Extraction
	browser_get_text: getText,
	browser_get_html: getHtml,
	browser_get_value: getValue,
	browser_get_attribute: getAttribute,
	browser_get_count: getCount,
	browser_get_box: getBoundingBox,
	browser_is_visible: isVisible,
	browser_is_enabled: isEnabled,
	browser_is_checked: isChecked,
	browser_eval: evalJs,
	// Wait & Find
	browser_wait_selector: waitForSelector,
	browser_wait_time: waitForTime,
	browser_wait_text: waitForText,
	browser_wait_url: waitForUrl,
	browser_wait_load: waitForLoad,
	browser_wait_condition: waitForCondition,
	browser_find_role: findByRole,
	browser_find_text: findByText,
	browser_find_label: findByLabel,
	browser_find_placeholder: findByPlaceholder,
	browser_find_testid: findByTestId,
	browser_find_first: findFirst,
	browser_find_nth: findNth,
	// Tabs & Frames
	browser_list_tabs: listTabs,
	browser_new_tab: newTab,
	browser_switch_tab: switchTab,
	browser_close_tab: closeTab,
	browser_switch_frame: switchToFrame,
	browser_main_frame: switchToMainFrame
} as const;
