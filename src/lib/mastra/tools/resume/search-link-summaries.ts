// src/lib/mastra/tools/resume/search-link-summaries.ts
// Resume agent tool that performs semantic search across AI-generated link
// summaries (GitHub, LinkedIn, Portfolio, etc.) stored in link_summary_vec.
//
// The resume agent uses this to pull relevant context about the candidate's
// projects, open-source work, professional presence, and portfolio pieces
// when tailoring a resume to a specific job description.

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { LinkSummaryVectorService } from '$lib/services/services/linkSummaryVector';
import type { AuditLogService } from '$lib/services/services/auditLog';

export function createSearchLinkSummariesTool(
	linkSummaryVectorService: LinkSummaryVectorService,
	auditLogService: AuditLogService
) {
	return createTool({
		id: 'search-link-summaries',
		description:
			'Search the candidate\'s scraped profile links (GitHub, LinkedIn, Portfolio, etc.) ' +
			'using semantic similarity. Returns the most relevant excerpts from AI-generated ' +
			'summaries of those links.\n\n' +
			'Use this tool when:\n' +
			'- You need details about the candidate\'s open-source projects or GitHub repositories\n' +
			'- You want to find portfolio pieces relevant to the target job\'s requirements\n' +
			'- You need to verify or expand on professional experience mentioned in the profile\n' +
			'- The job description references specific technologies and you want richer project context\n' +
			'- You want to surface accomplishments or skills not captured in the base profile text\n\n' +
			'Results include the full summary text, the source link title/URL, and a relevance ' +
			'distance (lower = more relevant).',
		inputSchema: z.object({
			query: z
				.string()
				.min(3)
				.describe(
					'Natural language search query describing what you are looking for. ' +
					'Be specific for better results. ' +
					'Examples: "React or TypeScript projects", ' +
					'"open source contributions", ' +
					'"machine learning work", ' +
					'"professional experience at startups".'
				),
			topK: z
				.number()
				.int()
				.min(1)
				.max(10)
				.optional()
				.describe(
					'Number of results to return. Defaults to 3. Increase if you need broader context.'
				)
		}),
		outputSchema: z.object({
			success: z.boolean(),
			results: z.array(
				z.object({
					linkTitle: z.string().describe('The source link title (e.g. "GitHub", "Portfolio").'),
					linkUrl: z.string().describe('The URL that was summarised.'),
					summaryType: z
						.string()
						.describe('Type of link: github | linkedin | portfolio | generic.'),
					summary: z.string().describe('The full AI-generated summary text for this link.'),
					distance: z
						.number()
						.describe('Cosine distance — lower is more relevant (0 = identical).')
				})
			),
			totalIndexed: z
				.number()
				.describe('Total number of link summaries currently indexed in the vector store.'),
			message: z.string()
		}),
		execute: async ({ query, topK }) => {
			const resolvedTopK = topK ?? 3;

			const finishAudit = auditLogService.start({
				category: 'resume',
				agent_id: 'resume-agent',
				title: `Link summary search: "${query.substring(0, 80)}"`,
				detail: `Searching top-${resolvedTopK} across indexed link summaries`,
				meta: { query, topK: resolvedTopK }
			});

			try {
				const totalIndexed = linkSummaryVectorService.getIndexedCount();

				if (totalIndexed === 0) {
					finishAudit({
						status: 'info',
						detail: 'No link summaries indexed yet.',
						meta: { query, totalIndexed: 0, resultsFound: 0 }
					});

					return {
						success: true,
						results: [],
						totalIndexed: 0,
						message:
							'No link summaries have been indexed yet. ' +
							'The user can generate summaries from the Links tab in the profile section.'
					};
				}

				const searchResults = await linkSummaryVectorService.search(query, resolvedTopK);

				const results = searchResults.map((r) => ({
					linkTitle: r.linkTitle,
					linkUrl: r.linkUrl,
					summaryType: r.summaryType,
					summary: r.summary,
					distance: r.distance
				}));

				finishAudit({
					status: 'success',
					detail: `Found ${results.length} results for "${query.substring(0, 80)}"`,
					meta: {
						query,
						topK: resolvedTopK,
						totalIndexed,
						resultsFound: results.length,
						topDistance: results[0]?.distance ?? null
					}
				});

				return {
					success: true,
					results,
					totalIndexed,
					message:
						results.length > 0
							? `Found ${results.length} relevant link summaries (of ${totalIndexed} indexed). ` +
								`Best match (distance ${results[0]!.distance.toFixed(4)}) is from "${results[0]!.linkTitle}".`
							: `No relevant results found for "${query}" across ${totalIndexed} indexed link summaries. ` +
								'Try a broader or different query.'
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);

				finishAudit({
					status: 'error',
					detail: `Link summary search failed: ${message}`,
					meta: { query, error: message }
				});

				return {
					success: false,
					results: [],
					totalIndexed: 0,
					message: `Link summary search failed: ${message}`
				};
			}
		}
	});
}
