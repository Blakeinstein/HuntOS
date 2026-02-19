// src/lib/mastra/tools/profile/scrape-website.ts
// Tool that scrapes a user-provided URL (GitHub, LinkedIn, portfolio, etc.)
// and extracts relevant professional information for the user profile.

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { ProfileService, ProfileKey } from '$lib/services/services/profile';
import type { AuditLogService } from '$lib/services/services/auditLog';

/**
 * Lightweight HTML-to-text extraction.
 * Strips tags, collapses whitespace, and decodes common HTML entities.
 */
function htmlToText(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, '')
		.replace(/<style[\s\S]*?<\/style>/gi, '')
		.replace(/<nav[\s\S]*?<\/nav>/gi, '')
		.replace(/<footer[\s\S]*?<\/footer>/gi, '')
		.replace(/<header[\s\S]*?<\/header>/gi, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Detect the type of website from a URL so the agent gets a hint
 * about what kind of data to expect.
 */
function detectSiteType(url: string): string {
	const lower = url.toLowerCase();
	if (lower.includes('github.com')) return 'github';
	if (lower.includes('linkedin.com')) return 'linkedin';
	if (lower.includes('gitlab.com')) return 'gitlab';
	if (lower.includes('bitbucket.org')) return 'bitbucket';
	if (lower.includes('stackoverflow.com') || lower.includes('stackexchange.com'))
		return 'stackoverflow';
	if (lower.includes('dev.to')) return 'devto';
	if (lower.includes('medium.com')) return 'medium';
	if (lower.includes('behance.net')) return 'behance';
	if (lower.includes('dribbble.com')) return 'dribbble';
	return 'generic';
}

/** Maximum characters we keep from scraped text to avoid blowing up context. */
const MAX_SCRAPED_TEXT_LENGTH = 15_000;

export function createScrapeWebsiteTool(
	profileService: ProfileService,
	auditLogService: AuditLogService
) {
	return createTool({
		id: 'scrape-website',
		description:
			'Fetch a URL provided by the user (e.g. their GitHub profile, LinkedIn page, portfolio site) ' +
			'and extract its text content. The extracted text is stored in the profile under "scraped_content" ' +
			'and returned to you so you can parse it for relevant professional information. ' +
			'After calling this tool, you should analyze the returned text and use the updateProfile tool ' +
			'to save any relevant fields (skills, projects, experience, etc.) you find. ' +
			'NOTE: Some sites (especially LinkedIn) may block scraping; in that case ask the user to paste the content directly.',
		inputSchema: z.object({
			url: z.string().url().describe('The URL to scrape. Must be a valid http/https URL.'),
			label: z
				.string()
				.optional()
				.describe(
					'Optional human-readable label for this link, e.g. "GitHub profile", "Personal portfolio".'
				)
		}),
		outputSchema: z.object({
			success: z.boolean(),
			siteType: z.string(),
			url: z.string(),
			textContent: z
				.string()
				.describe('The extracted text content from the page (truncated to a safe length).'),
			textLength: z.number(),
			message: z.string()
		}),
		execute: async ({ url, label }) => {
			const siteType = detectSiteType(url);
			const displayLabel = label || siteType;

			const finishAudit = auditLogService.start({
				category: 'profile',
				agent_id: 'profile-agent',
				title: `Scraping ${displayLabel}: ${url}`,
				detail: `Site type detected: ${siteType}`,
				meta: { url, siteType, label: displayLabel }
			});

			try {
				const response = await fetch(url, {
					headers: {
						'User-Agent':
							'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
						Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
						'Accept-Language': 'en-US,en;q=0.9'
					},
					signal: AbortSignal.timeout(15_000)
				});

				if (!response.ok) {
					const detail = `HTTP ${response.status} ${response.statusText} fetching ${url}`;

					finishAudit({
						status: 'warning',
						detail,
						meta: { url, siteType, httpStatus: response.status }
					});

					return {
						success: false,
						siteType,
						url,
						textContent: '',
						textLength: 0,
						message: `Failed to fetch ${url}: ${response.status} ${response.statusText}. ` +
							'The site may block automated requests. Ask the user to paste the content instead.'
					};
				}

				const contentType = response.headers.get('content-type') || '';
				const rawHtml = await response.text();

				let textContent: string;
				if (contentType.includes('application/json')) {
					// For JSON APIs (e.g. GitHub API), pretty-print the JSON
					try {
						const parsed = JSON.parse(rawHtml);
						textContent = JSON.stringify(parsed, null, 2);
					} catch {
						textContent = rawHtml;
					}
				} else {
					textContent = htmlToText(rawHtml);
				}

				// Truncate to avoid blowing up context windows
				const truncated =
					textContent.length > MAX_SCRAPED_TEXT_LENGTH
						? textContent.substring(0, MAX_SCRAPED_TEXT_LENGTH) + '\n\n[... truncated ...]'
						: textContent;

				// Store the URL in the user's website_urls list
				await profileService.appendToProfile('website_urls', [url]);

				// Also set the appropriate specific URL field if we recognize the site
				const urlFieldMap: Record<string, ProfileKey> = {
					github: 'github_url',
					linkedin: 'linkedin_url'
				};
				const specificField = urlFieldMap[siteType];
				if (specificField) {
					await profileService.updateProfile(specificField, url);
				}

				// Store the scraped content for reference
				const existingScraped = await profileService.getProfile('scraped_content');
				const existingText =
					typeof existingScraped['scraped_content'] === 'string'
						? existingScraped['scraped_content']
						: '';

				const separator = existingText.length > 0 ? '\n\n---\n\n' : '';
				const newContent = `${existingText}${separator}## Scraped from ${displayLabel} (${url})\n\n${truncated}`;

				// Cap the total stored scraped content
				const maxStoredLength = 50_000;
				const storedContent =
					newContent.length > maxStoredLength
						? newContent.substring(0, maxStoredLength) + '\n\n[... truncated ...]'
						: newContent;

				await profileService.updateProfile('scraped_content', storedContent);

				finishAudit({
					status: 'success',
					detail: `Successfully scraped ${url} (${truncated.length} chars extracted)`,
					meta: {
						url,
						siteType,
						originalLength: textContent.length,
						extractedLength: truncated.length,
						contentType
					}
				});

				return {
					success: true,
					siteType,
					url,
					textContent: truncated,
					textLength: truncated.length,
					message:
						`Successfully scraped ${displayLabel} (${siteType}). ` +
						`Extracted ${truncated.length} characters of text. ` +
						'Analyze this content and use updateProfile to save any relevant professional data you find.'
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Unknown error';
				const isTimeout = message.includes('timeout') || message.includes('abort');

				finishAudit({
					status: 'error',
					detail: `Failed to scrape ${url}: ${message}`,
					meta: { url, siteType, error: message, isTimeout }
				});

				return {
					success: false,
					siteType,
					url,
					textContent: '',
					textLength: 0,
					message: isTimeout
						? `Request to ${url} timed out. The site may be slow or blocking automated requests. ` +
							'Ask the user to paste the relevant content directly.'
						: `Failed to scrape ${url}: ${message}. ` +
							'Ask the user to paste the content manually instead.'
				};
			}
		}
	});
}
