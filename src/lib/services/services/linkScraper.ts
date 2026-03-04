// src/lib/services/services/linkScraper.ts
// Scrapes profile links (portfolio, LinkedIn, GitHub) using:
//   - LinkedIn  → agent-browser CLI (CDP into the user's running Chrome) so
//                 the user's existing session is used and login walls are avoided.
//   - GitHub    → Playwright headless (public, no login required).
//   - Portfolio → Playwright headless + sitemap.xml discovery.
//   - Generic   → Playwright headless fallback.
//
// If LinkedIn detects a login/auth wall it emits a `needs_login` status and
// returns early so the queue can surface the message to the UI.

import { chromium, type Page, type Browser } from 'playwright';
import { extractContent } from '@agent-infra/browser-context';
import { toMarkdown } from '@agent-infra/browser-context';
import { browserExec } from '$lib/mastra/tools/browser/exec';
import type { AuditLogService } from './auditLog';
import type { LinkSummaryService } from './linkSummary';
import type { ProfileService } from './profile';

// ── Sentinel thrown inside scrapeLinkedin when a login wall is detected ───────

export class LinkedInLoginRequiredError extends Error {
	constructor(message = 'LinkedIn requires login. Please sign in via the browser and retry.') {
		super(message);
		this.name = 'LinkedInLoginRequiredError';
	}
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Max characters of markdown kept per scraped page before truncation. */
const PAGE_MD_LIMIT = 8_000;

/** Timeout passed to agent-browser commands for LinkedIn navigation (ms). */
const AGENT_BROWSER_TIMEOUT_MS = 30_000;

/** Max portfolio pages crawled from sitemap. */
const PORTFOLIO_PAGE_LIMIT = 20;

/** Sitemap-not-found advisory appended to the summary. */
const NO_SITEMAP_ADVISORY = `
> **No sitemap found.**
> To help crawlers (and this tool) discover all your pages, consider adding a \`sitemap.xml\`
> to the root of your site and referencing it from \`robots.txt\` with:
> \`Sitemap: https://yourdomain.com/sitemap.xml\`
`.trim();

/** Navigation timeout per page (ms). */
const NAV_TIMEOUT_MS = 25_000;

/** Combined markdown limit across all portfolio pages. */
const PORTFOLIO_COMBINED_LIMIT = 30_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function truncate(text: string, limit = PAGE_MD_LIMIT): string {
	if (text.length <= limit) return text;
	return text.slice(0, limit) + '\n\n[…truncated]';
}

/**
 * Launch a Playwright Chromium browser instance, run `fn`, then close it.
 */
async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
	const browser = await chromium.launch({ headless: true });
	try {
		return await fn(browser);
	} finally {
		await browser.close();
	}
}

/**
 * Create a new page with sensible defaults and navigate to `url`.
 * Returns the page; caller is responsible for closing it.
 */
async function openPage(browser: Browser, url: string): Promise<Page> {
	const ctx = await browser.newContext({
		userAgent:
			'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
		// Helps bypass some bot-detection that checks for missing accept headers
		extraHTTPHeaders: {
			Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
			'Accept-Language': 'en-US,en;q=0.9'
		}
	});
	const page = await ctx.newPage();
	await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });
	return page;
}

/**
 * Extract markdown from a page using @agent-infra/browser-context.
 * Falls back to raw innerText if extraction fails.
 */
async function pageToMarkdown(page: Page): Promise<string> {
	try {
		// extractContent uses Readability under the hood to pull the main article/content.
		// puppeteer-core's Page type is structurally compatible with Playwright's Page
		// for the subset of methods extractContent actually calls (evaluate, url, etc.)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const { content } = await extractContent(page as any);
		if (content && content.trim().length > 100) {
			return truncate(content);
		}
	} catch {
		// fall through to HTML fallback
	}

	// Fallback: grab raw HTML and convert to markdown ourselves
	try {
		const html = await page.evaluate<string>(`
			(function () {
				['script','style','nav','footer','header','noscript','iframe','svg'].forEach(t => {
					document.querySelectorAll(t).forEach(el => el.remove());
				});
				return document.documentElement.outerHTML;
			})()
		`);
		if (html) {
			const md = toMarkdown(html, { gfmExtension: true });
			return truncate(md);
		}
	} catch {
		// last resort
	}

	// Absolute fallback: innerText
	try {
		const text = await page.evaluate<string>(`document.body ? document.body.innerText : ''`);
		return truncate(text ?? '');
	} catch {
		return '';
	}
}

interface SitemapResult {
	found: boolean;
	urls: string[];
}

/**
 * Fetch raw XML text from a URL via a headless page.
 * Returns null if the page is not valid XML / sitemap content.
 */
async function fetchXmlText(browser: Browser, url: string): Promise<string | null> {
	let page: Page | null = null;
	try {
		page = await openPage(browser, url);
		const xmlText = await page.evaluate<string>(
			`document.documentElement ? document.documentElement.outerHTML : ''`
		);
		// A valid sitemap / robots file will always have these markers
		return xmlText && xmlText.length > 50 ? xmlText : null;
	} catch {
		return null;
	} finally {
		if (page)
			await page
				.context()
				.close()
				.catch(() => {});
	}
}

/**
 * Parse all <loc> entries from a sitemap XML string.
 * Handles both regular sitemaps and sitemap-index files (nested <sitemap> blocks).
 */
function parseLocUrls(xmlText: string): string[] {
	const matches = [...xmlText.matchAll(/<loc>\s*(https?:\/\/[^<\s]+)\s*<\/loc>/gi)];
	return [...new Set(matches.map((m) => m[1].trim()))];
}

/**
 * Try to discover the sitemap URL from robots.txt, then fall back to /sitemap.xml.
 * Returns the resolved sitemap URL or null if none could be found.
 */
async function discoverSitemapUrl(browser: Browser, rootUrl: string): Promise<string | null> {
	// 1. Check robots.txt for a Sitemap: directive
	const robotsUrl = new URL('/robots.txt', rootUrl).toString();
	const robotsText = await fetchXmlText(browser, robotsUrl);
	if (robotsText) {
		const m = robotsText.match(/Sitemap:\s*(https?:\/\/[^\s<"]+)/i);
		if (m) return m[1].trim();
	}

	// 2. Fall back to the conventional /sitemap.xml location
	const defaultSitemapUrl = new URL('/sitemap.xml', rootUrl).toString();
	const sitemapText = await fetchXmlText(browser, defaultSitemapUrl);
	if (sitemapText && sitemapText.includes('<loc>')) return defaultSitemapUrl;

	return null;
}

/**
 * Try to fetch and parse sitemap(s) for the given root URL.
 *
 * Handles:
 *  - Sitemap index files (lists of nested sitemaps)
 *  - Regular sitemaps
 *  - robots.txt-based discovery
 *
 * Returns `found: false` (and an empty url list) when no sitemap exists so that
 * the caller can surface a recommendation to the user.
 */
async function fetchSitemapUrls(browser: Browser, rootUrl: string): Promise<SitemapResult> {
	const sitemapUrl = await discoverSitemapUrl(browser, rootUrl);
	if (!sitemapUrl) return { found: false, urls: [] };

	const xmlText = await fetchXmlText(browser, sitemapUrl);
	if (!xmlText) return { found: false, urls: [] };

	// Detect sitemap index: contains <sitemap> wrapper elements with nested <loc>s
	const isSitemapIndex = /<sitemap[\s>]/i.test(xmlText);
	if (isSitemapIndex) {
		// Each nested <loc> points to a child sitemap; fetch all in parallel
		const childSitemapUrls = parseLocUrls(xmlText);
		const childResults = await Promise.allSettled(
			childSitemapUrls.map((u) => fetchXmlText(browser, u))
		);
		const allUrls: string[] = [];
		for (const r of childResults) {
			if (r.status === 'fulfilled' && r.value) {
				allUrls.push(...parseLocUrls(r.value));
			}
		}
		const deduped = [...new Set(allUrls)].slice(0, PORTFOLIO_PAGE_LIMIT);
		return { found: true, urls: deduped };
	}

	// Regular sitemap
	const urls = parseLocUrls(xmlText).slice(0, PORTFOLIO_PAGE_LIMIT);
	return { found: true, urls };
}

// ── GitHub Scraper ────────────────────────────────────────────────────────────

/**
 * Scrape a GitHub profile and produce a structured developer summary in Markdown.
 *
 * Extracts: profile bio/headline, pinned repos, top repos, contribution activity.
 * Does NOT infer skills from starred repositories.
 */
export async function scrapeGithub(url: string): Promise<string> {
	return withBrowser(async (browser) => {
		let page: Page | null = null;
		try {
			page = await openPage(browser, url);

			// Remove noise before extraction
			await page.evaluate<void>(`
				['script','style','noscript'].forEach(t => {
					document.querySelectorAll(t).forEach(el => el.remove());
				});
			`);

			// Profile intro
			const intro = await page.evaluate<string>(`
				(function () {
					const parts = [];
					const name = document.querySelector('[itemprop="name"]');
					const bio  = document.querySelector('.p-note');
					const company  = document.querySelector('[itemprop="worksFor"]');
					const location = document.querySelector('[itemprop="homeLocation"]');
					const website  = document.querySelector('[itemprop="url"]');
					if (name)     parts.push('**Name:** ' + name.innerText.trim());
					if (bio)      parts.push('**Bio:** ' + bio.innerText.trim());
					if (company)  parts.push('**Company:** ' + company.innerText.trim());
					if (location) parts.push('**Location:** ' + location.innerText.trim());
					if (website)  parts.push('**Website:** ' + (website.href || website.innerText.trim()));
					return parts.join('\\n');
				})()
			`);

			// Pinned repos
			const pinned = await page.evaluate<string>(`
				(function () {
					const cards = document.querySelectorAll('.pinned-item-list-item');
					if (!cards.length) return '';
					const items = [];
					cards.forEach(card => {
						const repo = card.querySelector('.repo');
						const desc = card.querySelector('.pinned-item-desc');
						const lang = card.querySelector('[itemprop="programmingLanguage"]');
						const stars = card.querySelector('.pinned-item-meta');
						let line = '- ' + (repo ? repo.innerText.trim() : '(unnamed)');
						if (lang)  line += ' [' + lang.innerText.trim() + ']';
						if (stars) line += ' \\u2605' + stars.innerText.trim();
						if (desc)  line += ' — ' + desc.innerText.trim();
						items.push(line);
					});
					return '**Pinned Repositories:**\\n' + items.join('\\n');
				})()
			`);

			// Contribution count headline
			const contributions = await page.evaluate<string>(`
				(function () {
					const el = document.querySelector('.js-yearly-contributions h2');
					return el ? '**Contributions:** ' + el.innerText.trim() : '';
				})()
			`);

			// Top (non-forked) repos listed on the profile
			const topRepos = await page.evaluate<string>(`
				(function () {
					const items = [];
					document.querySelectorAll('#user-repositories-list li').forEach(li => {
						const name = li.querySelector('[itemprop="name codeRepository"]');
						const desc = li.querySelector('[itemprop="description"]');
						const lang = li.querySelector('[itemprop="programmingLanguage"]');
						if (!name) return;
						let line = '- ' + name.innerText.trim();
						if (lang) line += ' [' + lang.innerText.trim() + ']';
						if (desc) line += ' — ' + desc.innerText.trim();
						items.push(line);
					});
					return items.length ? '**Repositories:**\\n' + items.slice(0, 15).join('\\n') : '';
				})()
			`);

			const sections = ['# GitHub Profile Summary', intro, pinned, contributions, topRepos]
				.map((s) => s.trim())
				.filter(Boolean);

			if (sections.length <= 1) {
				// Fallback to full-page extraction
				const md = await pageToMarkdown(page);
				return `# GitHub Profile Summary\n\n${md}`;
			}

			return truncate(sections.join('\n\n'));
		} finally {
			if (page)
				await page
					.context()
					.close()
					.catch(() => {});
		}
	});
}

// ── LinkedIn Scraper ──────────────────────────────────────────────────────────

/**
 * Scrape a LinkedIn profile using the user's already-running Chrome browser
 * via agent-browser (CDP). This means the user's existing LinkedIn session is
 * used, avoiding the login wall.
 *
 * Extraction strategy:
 *   1. Navigate and wait for networkidle + a small extra settle delay so
 *      LinkedIn's React SPA finishes rendering.
 *   2. Scroll through the page to trigger lazy-loaded sections (Experience,
 *      Education, Skills).
 *   3. Take an accessibility-tree snapshot via `agent-browser snapshot`.
 *      The a11y tree reflects what the browser actually rendered — far more
 *      reliable than DOM eval queries that returned empty on LinkedIn's SPA.
 *   4. Parse the snapshot with `parseLinkedInSnapshot` which understands the
 *      indented tree format and extracts only the meaningful profile sections
 *      (intro, about, experience, education, skills, certifications).
 *      Everything else (nav, ads, analytics, posts/activity) is discarded.
 *   5. Fall back to `get text body` if the snapshot is too thin.
 *
 * Login-wall detection:
 *   After navigation we inspect the current URL and page title. If we land on
 *   any authentication/checkpoint page we throw `LinkedInLoginRequiredError`
 *   so the queue can mark the job as `needs_login` and surface a prompt.
 */
export async function scrapeLinkedin(url: string): Promise<string> {
	// ── Step 1: Navigate and wait for the SPA to fully render ────────────────
	const navResult = await browserExec(['open', url], { timeout: AGENT_BROWSER_TIMEOUT_MS });
	if (!navResult.success) {
		throw new Error(`Failed to navigate to LinkedIn profile: ${navResult.stderr}`);
	}

	// Wait for network to settle — LinkedIn is a heavy SPA
	await browserExec(['wait', '--load', 'networkidle'], { timeout: AGENT_BROWSER_TIMEOUT_MS });

	// Extra settle time for late-rendering React components
	await browserExec(['wait', '2000'], { timeout: 10_000 });

	// ── Step 2: Login-wall detection ─────────────────────────────────────────
	const urlResult = await browserExec(['get', 'url']);
	const currentUrl = urlResult.stdout.trim().toLowerCase();

	const LOGIN_WALL_PATTERNS = [
		'/login',
		'/signin',
		'/checkpoint',
		'/authwall',
		'/uas/login',
		'linkedin.com/login',
		'linkedin.com/checkpoint'
	];
	if (LOGIN_WALL_PATTERNS.some((p) => currentUrl.includes(p))) {
		throw new LinkedInLoginRequiredError();
	}

	const titleResult = await browserExec(['get', 'title']);
	const pageTitle = titleResult.stdout.trim().toLowerCase();
	if (
		pageTitle.includes('sign in') ||
		pageTitle.includes('log in') ||
		pageTitle.includes('join linkedin')
	) {
		throw new LinkedInLoginRequiredError();
	}

	// ── Step 3: Scroll to trigger lazy-loaded sections ────────────────────────
	// LinkedIn lazy-loads Experience, Education, Skills as you scroll down.
	for (let i = 0; i < 5; i++) {
		await browserExec(['scroll', 'down', '800']);
		await browserExec(['wait', '600'], { timeout: 5_000 });
	}
	// Scroll back to top so snapshot starts from the beginning
	await browserExec(['scroll', 'up', '9999']);
	await browserExec(['wait', '500'], { timeout: 5_000 });

	// ── Step 4: Primary extraction via accessibility snapshot ─────────────────
	const snapshotResult = await browserExec(['snapshot'], { timeout: 20_000 });
	const snapshotText = snapshotResult.success ? snapshotResult.stdout.trim() : '';

	if (snapshotText.length > 500) {
		const parsed = parseLinkedInSnapshot(snapshotText);
		if (parsed.length > 300) {
			return truncate(parsed);
		}
	}

	// ── Step 5: Fallback — get the rendered body text ─────────────────────────
	const textResult = await browserExec(['get', 'text', 'body'], { timeout: 15_000 });
	const bodyText = textResult.success ? textResult.stdout.trim() : '';

	if (!bodyText) {
		throw new LinkedInLoginRequiredError(
			'LinkedIn page appeared empty after load. You may need to log in via the browser.'
		);
	}

	return truncate(`# LinkedIn Profile Summary\n\n${bodyText}`);
}

// ── LinkedIn snapshot parser ──────────────────────────────────────────────────

/**
 * The sections we want to extract from the LinkedIn profile snapshot.
 * Maps lowercase heading text → markdown section title.
 * Everything NOT in this list (activity, analytics, ads, suggested, etc.) is dropped.
 */
const LINKEDIN_WANTED_SECTIONS: Record<string, string> = {
	about: 'About',
	experience: 'Experience',
	education: 'Education',
	skills: 'Skills',
	certifications: 'Certifications',
	licenses: 'Certifications',
	'licenses & certifications': 'Certifications',
	publications: 'Publications',
	projects: 'Projects',
	volunteering: 'Volunteering',
	languages: 'Languages',
	recommendations: 'Recommendations',
	honors: 'Honors & Awards',
	'honors & awards': 'Honors & Awards',
	courses: 'Courses',
	patents: 'Patents'
};

/**
 * Sections to explicitly skip — we never want their content even if they
 * happen to appear before a wanted section boundary.
 */
const LINKEDIN_SKIP_SECTIONS = new Set([
	'activity',
	'analytics',
	'suggested for you',
	'people also viewed',
	'people you may know',
	'more profiles for you',
	'featured',
	'add profile section',
	'open to'
]);

/**
 * Parse an agent-browser accessibility-tree snapshot of a LinkedIn profile page
 * and extract only the meaningful professional sections as clean Markdown.
 *
 * The snapshot is an indented tree where each node looks like one of:
 *   - heading "Section Name" [ref=eN] [level=2]
 *   - paragraph: Some text
 *   - text: Some text
 *   - button "Label" [ref=eN]: Visible text
 *   - link "Label" [ref=eN]: ...
 *
 * Strategy:
 *   1. Extract the profile intro (name, headline, location, connections) from
 *      the `main > main` block that precedes any named section heading.
 *   2. Walk the lines looking for level-2 headings. When we find one that
 *      matches a wanted section, collect all descendant text until the next
 *      level-2 heading. Skip sections in the SKIP list entirely.
 *   3. Deduplicate and clean the collected text lines before emitting them.
 */
function parseLinkedInSnapshot(snapshot: string): string {
	const lines = snapshot.split('\n');
	const output: string[] = ['# LinkedIn Profile Summary'];

	// ── Helpers ───────────────────────────────────────────────────────────────

	/**
	 * Extract the human-readable text value from a snapshot node line.
	 * e.g.:
	 *   `  - paragraph: Some text`           → "Some text"
	 *   `  - heading "About" [ref=e44]`      → "About"
	 *   `  - button "Edit" [ref=e20]: Edit`  → "Edit"  (prefers trailing label)
	 *   `  - text: Some text`                → "Some text"
	 *   `  - strong: Some text`              → "Some text"
	 */
	function nodeText(line: string): string {
		const trimmed = line.trim();
		// "- type: trailing text"
		const colonText = trimmed.match(/^-\s+\w[\w-]*:\s+(.+)$/);
		if (colonText) return colonText[1].trim();
		// `- heading "text" [...]` or `- button "text" [...]: label`
		const quoted = trimmed.match(/^-\s+\w[\w-]*\s+"([^"]+)"/);
		if (quoted) return quoted[1].trim();
		return '';
	}

	/**
	 * Return the heading level if the line is a heading node, else null.
	 * e.g. `- heading "About" [ref=e44] [level=2]` → 2
	 */
	function headingLevel(line: string): number | null {
		const m = line.match(/\[level=(\d+)\]/);
		if (!m) return null;
		const trimmed = line.trim();
		if (!trimmed.startsWith('- heading')) return null;
		return parseInt(m[1], 10);
	}

	/**
	 * Extract the heading label from a heading line.
	 */
	function headingLabel(line: string): string {
		const m = line.trim().match(/^-\s+heading\s+"([^"]+)"/);
		return m ? m[1].trim() : '';
	}

	// ── Step A: Extract profile intro ─────────────────────────────────────────
	// The intro block lives inside `main > main` before the first named heading.
	// We pick out paragraphs that contain: name (h2), pronoun, headline, location,
	// connections. We identify the name as the first h2 inside `main`.
	let name = '';
	let pronoun = '';
	let headline = '';
	let location = '';
	let connections = '';

	// Find the outer `- main:` block (there are two nested ones; we want
	// the inner one that contains profile content, not the toolbar).
	// We look for paragraphs that appear before the "About" heading at
	// relatively shallow indentation inside the main block.
	let inMain = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();
		if (!trimmed) continue;

		// Detect entry into main content area
		if (!inMain && trimmed === '- main:') {
			inMain = true;
			continue;
		}

		if (!inMain) continue;

		const level = headingLevel(line);

		if (level === 2) {
			const label = headingLabel(line);
			// The profile name is an h2 — capture it before anything else
			if (!name) {
				name = label;
				continue;
			}
			// Any subsequent h2 is a section heading (About, Experience, etc.) — stop intro
			break;
		}

		const text = nodeText(line);
		if (!text) continue;

		// He/Him, She/Her, They/Them etc.
		if (!pronoun && /^(he|she|they|it)\//i.test(text)) {
			pronoun = text;
			continue;
		}

		// Connections line
		if (!connections && /\d+\s*(connections?|followers?)/i.test(text)) {
			connections = text.replace(/\s*·\s*/g, ' ').trim();
			continue;
		}

		// Headline: typically the first paragraph after the name h2
		// It usually doesn't contain digits, slashes, or look like a location
		if (
			name &&
			!headline &&
			text.length > 3 &&
			!/^\d/.test(text) &&
			!/,\s+[A-Z]/.test(text) &&
			!text.includes('·') &&
			!/^(open to|edit|add|show|view|tell|dismiss|close|retry|get|stand)/i.test(text)
		) {
			headline = text;
			continue;
		}

		// Location: "City, State, Country" pattern
		if (
			!location &&
			/,\s+[A-Za-z]/.test(text) &&
			text.split(',').length >= 2 &&
			text.length < 80 &&
			!text.includes('·')
		) {
			location = text;
			continue;
		}
	}

	// Emit intro block
	const introLines: string[] = [];
	if (name) introLines.push(`**Name:** ${name}`);
	if (pronoun) introLines.push(`**Pronouns:** ${pronoun}`);
	if (headline) introLines.push(`**Headline:** ${headline}`);
	if (location) introLines.push(`**Location:** ${location}`);
	if (connections) introLines.push(`**Connections:** ${connections}`);
	if (introLines.length) {
		output.push('');
		output.push(...introLines);
	}

	// ── Step B: Walk sections ─────────────────────────────────────────────────
	// Find level-2 headings and collect their content until the next heading.
	// Skip unwanted sections entirely.

	let currentSection: string | null = null; // markdown title of current section
	let skipSection = false; // true → discard lines until next heading
	let sectionLines: string[] = []; // accumulated lines for current section
	let seenTexts = new Set<string>(); // dedup within a section

	function flushSection() {
		if (currentSection && sectionLines.length) {
			output.push('');
			output.push(`## ${currentSection}`);
			output.push(...sectionLines);
		}
		sectionLines = [];
		seenTexts = new Set();
	}

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();
		if (!trimmed) continue;

		const level = headingLevel(line);

		if (level === 2) {
			// Flush previous section
			flushSection();

			const label = headingLabel(line).toLowerCase();

			if (LINKEDIN_SKIP_SECTIONS.has(label)) {
				currentSection = null;
				skipSection = true;
				continue;
			}

			const mdTitle = LINKEDIN_WANTED_SECTIONS[label];
			if (mdTitle) {
				currentSection = mdTitle;
				skipSection = false;
			} else {
				currentSection = null;
				skipSection = true;
			}
			continue;
		}

		// Level-3 headings inside a wanted section become bold items
		if (level === 3 && !skipSection && currentSection) {
			const label = headingLabel(line);
			if (label && !seenTexts.has(label)) {
				seenTexts.add(label);
				sectionLines.push(`**${label}**`);
			}
			continue;
		}

		if (skipSection || !currentSection) continue;

		// Skip structural / chrome lines
		if (
			trimmed.startsWith('- banner') ||
			trimmed.startsWith('- navigation') ||
			trimmed.startsWith('- toolbar') ||
			trimmed.startsWith('- search') ||
			trimmed.startsWith('- img') ||
			trimmed.startsWith('- figure') ||
			trimmed.startsWith('- /url')
		)
			continue;

		// Skip edit/add/show/dismiss controls
		const text = nodeText(line);
		if (!text) continue;

		if (
			/^(edit|add|show|dismiss|close|see more|see less|view all|show all|follow|connect|message|more|endorse)/i.test(
				text
			)
		)
			continue;

		// Skip lines that look like linkedin internal URLs
		if (/linkedin\.com\/(in|overlay|edit|analytics|dashboard|premium|redir)/i.test(text)) continue;

		// Skip "Private to you", "Past N days" analytics noise
		if (/^(private to you|past \d+ days?|discover who|check out who|see how often)/i.test(text))
			continue;

		if (seenTexts.has(text)) continue;
		seenTexts.add(text);
		sectionLines.push(text);
	}

	// Flush the last section
	flushSection();

	return output.join('\n');
}

// ── Portfolio Scraper ─────────────────────────────────────────────────────────

/**
 * Scrape a single portfolio page and return formatted markdown, or null on failure.
 */
async function scrapePortfolioPage(browser: Browser, pageUrl: string): Promise<string | null> {
	let page: Page | null = null;
	try {
		page = await openPage(browser, pageUrl);
		const md = await pageToMarkdown(page);
		if (!md.trim()) return null;
		return `## Page: ${pageUrl}\n\n${md}`;
	} catch {
		return null;
	} finally {
		if (page)
			await page
				.context()
				.close()
				.catch(() => {});
	}
}

/**
 * Scrape a portfolio website.
 *
 * Strategy:
 *  1. Discover sitemap via robots.txt or /sitemap.xml (including sitemap-index).
 *     - If NO sitemap is found: crawl only the homepage and append a recommendation
 *       advising the user to add a sitemap.
 *     - If a sitemap IS found: report how many URLs were discovered, then fetch
 *       ALL pages in parallel using Promise.allSettled.
 *  2. Combine all extracted page markdowns into a single portfolio summary.
 *
 * Uses @agent-infra/browser-context (Readability) per page for clean extraction.
 */
export async function scrapePortfolio(url: string): Promise<string> {
	return withBrowser(async (browser) => {
		const rootUrl = new URL(url).origin;

		// ── 1. Sitemap discovery ──────────────────────────────────────────────
		const sitemapResult = await fetchSitemapUrls(browser, rootUrl);

		const headerLines: string[] = ['# Portfolio Summary'];

		let pagesToCrawl: string[];
		if (!sitemapResult.found || sitemapResult.urls.length === 0) {
			headerLines.push('', NO_SITEMAP_ADVISORY, '', '> Falling back to homepage-only crawl.');
			pagesToCrawl = [url];
		} else {
			const count = sitemapResult.urls.length;
			headerLines.push(
				'',
				`> **Sitemap found** — discovered **${count}** URL${count === 1 ? '' : 's'}.` +
					(count === PORTFOLIO_PAGE_LIMIT ? ` (capped at ${PORTFOLIO_PAGE_LIMIT} pages)` : '')
			);
			pagesToCrawl = sitemapResult.urls;
		}

		// ── 2. Parallel page fetch ────────────────────────────────────────────
		const results = await Promise.allSettled(
			pagesToCrawl.map((pageUrl) => scrapePortfolioPage(browser, pageUrl))
		);

		const pageMarkdowns: string[] = [];
		for (const r of results) {
			if (r.status === 'fulfilled' && r.value) {
				pageMarkdowns.push(r.value);
			}
		}

		if (!pageMarkdowns.length) {
			return [...headerLines, '', '(No content could be extracted from the portfolio site.)'].join(
				'\n'
			);
		}

		const header = headerLines.join('\n');
		const body = pageMarkdowns.join('\n\n---\n\n');
		const combined = `${header}\n\n${body}`;
		return truncate(combined, PORTFOLIO_COMBINED_LIMIT);
	});
}

// ── Generic Scraper ───────────────────────────────────────────────────────────

/**
 * Generic fallback: navigate to `url` and extract page content via Readability.
 */
export async function scrapeGeneric(url: string): Promise<string> {
	return withBrowser(async (browser) => {
		let page: Page | null = null;
		try {
			page = await openPage(browser, url);
			const md = await pageToMarkdown(page);
			return md || '(No content could be extracted.)';
		} finally {
			if (page)
				await page
					.context()
					.close()
					.catch(() => {});
		}
	});
}

// ── Site Category Detector ────────────────────────────────────────────────────

export type SiteCategory = 'github' | 'linkedin' | 'portfolio' | 'generic';

export function detectSiteCategory(title: string, url: string): SiteCategory {
	const lt = title.toLowerCase();
	const lu = url.toLowerCase();
	if (lt.includes('github') || lu.includes('github.com')) return 'github';
	if (lt.includes('linkedin') || lu.includes('linkedin.com')) return 'linkedin';
	if (lt.includes('portfolio') || lt.includes('website') || lt.includes('site')) return 'portfolio';
	return 'generic';
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export interface ScrapeOptions {
	title: string;
	url: string;
	auditLogService: AuditLogService;
	linkSummaryService: LinkSummaryService;
	profileService?: ProfileService;
}

/**
 * Dispatch a scrape job for a single link.
 *
 * - Detects the site category from title + URL.
 * - Runs the appropriate scraper (GitHub / LinkedIn / Portfolio / Generic).
 * - Persists the result via `LinkSummaryService`.
 * - Emits audit log events (queued → running → success | error).
 * - Optionally appends raw scraped markdown to the profile's `scraped_content`
 *   field so other agents can reference it directly.
 */
export async function scrapeLinkAndSummarise(opts: ScrapeOptions): Promise<void> {
	const { title, url, auditLogService, linkSummaryService, profileService } = opts;
	const category = detectSiteCategory(title, url);

	// Mark running
	linkSummaryService.upsert({
		link_title: title,
		link_url: url,
		summary_type: category,
		status: 'running'
	});

	const finish = auditLogService.start({
		category: 'profile',
		agent_id: 'link-summariser',
		title: `Summarising ${title} (${category})`,
		detail: url,
		meta: { link_title: title, url, site_category: category }
	});

	try {
		let raw = '';
		switch (category) {
			case 'github':
				raw = await scrapeGithub(url);
				break;
			case 'linkedin':
				raw = await scrapeLinkedin(url);
				break;
			case 'portfolio':
				raw = await scrapePortfolio(url);
				break;
			default:
				raw = await scrapeGeneric(url);
		}

		if (!raw || raw.trim() === '(No content could be extracted.)') {
			throw new Error('No usable content could be extracted from the page.');
		}

		// Persist summary
		linkSummaryService.markDone(title, raw);

		// Optionally append to profile scraped_content
		if (profileService) {
			try {
				const existing = await profileService.getProfile('scraped_content');
				const existingText =
					typeof existing['scraped_content'] === 'string' ? existing['scraped_content'] : '';
				const separator = existingText.length > 0 ? '\n\n---\n\n' : '';
				const updated = `${existingText}${separator}## ${title} (${url})\n\n${raw}`;
				const maxLen = 50_000;
				await profileService.updateProfile(
					'scraped_content',
					updated.length > maxLen ? updated.slice(0, maxLen) + '\n\n[…truncated]' : updated
				);
			} catch {
				// Non-fatal — summary was already saved above
			}
		}

		finish({
			status: 'success',
			detail: `Extracted ${raw.length} characters for "${title}"`,
			meta: { extractedLength: raw.length, site_category: category }
		});
	} catch (err) {
		// ── LinkedIn login wall — surface as a distinct status ────────────────
		if (err instanceof LinkedInLoginRequiredError) {
			linkSummaryService.markNeedsLogin(title, err.message);
			finish({
				status: 'warning',
				detail: `LinkedIn login required for "${title}": ${err.message}`,
				meta: { needs_login: true, site_category: category }
			});
			return;
		}

		const message = err instanceof Error ? err.message : String(err);
		linkSummaryService.markError(title, message);
		finish({
			status: 'error',
			detail: `Failed to summarise "${title}": ${message}`,
			meta: { error: message, site_category: category }
		});
	}
}
