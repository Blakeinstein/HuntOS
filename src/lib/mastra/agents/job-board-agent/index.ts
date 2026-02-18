/**
 * Job Board Agent — barrel export.
 *
 * Re-exports the orchestrator agent factory (the top-level entry point),
 * the sub-agent registry with all registered board-specific agents,
 * and shared types/schemas used across the job-board-agent family.
 */

// ── Orchestrator ────────────────────────────────────────────────────
export { createJobBoardAgent, createJobBoardSubAgentRegistry } from './orchestrator.agent';

// ── Sub-agents ──────────────────────────────────────────────────────
export { createLinkedInAgent } from './linkedin.agent';
export { createGreenhouseAgent } from './greenhouse.agent';
export { createGenericAgent } from './generic.agent';

// ── Registry ────────────────────────────────────────────────────────
export { SubAgentRegistry, type SubAgentEntry } from './registry';

// ── Types & Schemas ─────────────────────────────────────────────────
export {
	scrapeResultSchema,
	scrapedJobSchema,
	jobBoardRequestContextSchema,
	paginationContextSchema,
	routingDecisionSchema,
	jobTypeEnum,
	BOARD_AGENT_MAP,
	type ScrapeResult,
	type ScrapedJob,
	type JobBoardRequestContext,
	type PaginationContext,
	type RoutingDecision,
	type JobBoardId,
	type JobType
} from './types';
