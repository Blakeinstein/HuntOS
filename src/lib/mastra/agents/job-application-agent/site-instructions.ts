import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolved site identification result.
 */
export interface SiteMatch {
	/** Human-readable site/ATS name (e.g. "LinkedIn", "Greenhouse"). */
	site: string;
	/** The markdown filename in the `sites/` directory (without extension). */
	slug: string;
}

/**
 * URL-matching rules for known application sites.
 * Evaluated in order — first match wins.
 */
const SITE_RULES: Array<{ site: string; slug: string; match: (url: string) => boolean }> = [
	{
		site: 'LinkedIn',
		slug: 'linkedin',
		match: (url) => /linkedin\.com/i.test(url)
	},
	{
		site: 'Greenhouse',
		slug: 'greenhouse',
		match: (url) => /greenhouse\.io/i.test(url)
	}
	// Add more site rules here as needed:
	// { site: 'Lever', slug: 'lever', match: (url) => /lever\.co/i.test(url) },
	// { site: 'Workday', slug: 'workday', match: (url) => /workday|myworkdayjobs/i.test(url) },
];

/**
 * Path to the `sites/` directory containing supplemental instruction markdown
 * files. These live alongside the prompt files in the prompts directory.
 */
const SITES_DIR = resolve(
	__dirname,
	'..',
	'..',
	'prompts',
	'job-application-agent',
	'sites'
);

/** In-memory cache for loaded site instruction files. */
const instructionCache = new Map<string, string>();

/**
 * Identify which known application site (if any) matches the given URL.
 *
 * @returns A `SiteMatch` for known sites, or `null` for unknown/generic sites.
 */
export function identifySite(url: string): SiteMatch | null {
	for (const rule of SITE_RULES) {
		if (rule.match(url)) {
			return { site: rule.site, slug: rule.slug };
		}
	}
	return null;
}

/**
 * Load site-specific supplemental instruction markdown for the given slug.
 *
 * @param slug - The site slug (e.g. "linkedin", "greenhouse").
 * @returns The markdown content, or `null` if no instructions file exists.
 */
export function loadSiteInstructions(slug: string): string | null {
	const cached = instructionCache.get(slug);
	if (cached !== undefined) return cached;

	const filePath = resolve(SITES_DIR, `${slug}.md`);

	try {
		statSync(filePath);
	} catch {
		return null;
	}

	try {
		const content = readFileSync(filePath, 'utf-8').trim();
		instructionCache.set(slug, content);
		return content;
	} catch {
		return null;
	}
}

/**
 * Resolve site-specific instructions for a given application URL.
 *
 * This is the main entry point used by the unified job-application agent.
 * It identifies the site from the URL and loads the corresponding
 * supplemental instruction markdown file from `prompts/job-application-agent/sites/`.
 *
 * @param url - The job application URL.
 * @returns An object containing the site name and instruction markdown,
 *          or a generic fallback if no site-specific instructions exist.
 *
 * @example
 * ```ts
 * const { site, instructions } = resolveSiteInstructions(
 *   'https://boards.greenhouse.io/acme/jobs/123'
 * );
 * // site => "Greenhouse"
 * // instructions => contents of sites/greenhouse.md
 * ```
 */
export function resolveSiteInstructions(url: string): {
	site: string;
	instructions: string;
} {
	const match = identifySite(url);

	if (match) {
		const instructions = loadSiteInstructions(match.slug);
		if (instructions) {
			return { site: match.site, instructions };
		}
	}

	// Generic fallback — no site-specific instructions
	return {
		site: match?.site ?? 'Generic',
		instructions:
			'No site-specific instructions available for this URL. ' +
			'Use the generic form-filling approach described above. ' +
			'Inspect the page carefully with `browser-snapshot` and adapt to whatever form layout is present.'
	};
}

/**
 * Clear the instruction cache (useful for tests or hot-reload scenarios).
 */
export function clearSiteInstructionCache(): void {
	instructionCache.clear();
}

/**
 * List all known site rules and whether their instruction files exist.
 * Useful for debugging or displaying in a UI.
 */
export function listKnownSites(): Array<{
	site: string;
	slug: string;
	hasInstructions: boolean;
}> {
	return SITE_RULES.map((rule) => {
		const filePath = resolve(SITES_DIR, `${rule.slug}.md`);
		let hasInstructions = false;
		try {
			statSync(filePath);
			hasInstructions = true;
		} catch {
			// file doesn't exist
		}
		return { site: rule.site, slug: rule.slug, hasInstructions };
	});
}
