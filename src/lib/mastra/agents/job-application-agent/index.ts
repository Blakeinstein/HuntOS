/**
 * Job Application Agent — barrel export.
 *
 * Re-exports the orchestrator agent factory (the top-level entry point),
 * the sub-agent registry with all registered site-specific agents,
 * and shared types/schemas used across the job-application-agent family.
 */

// ── Orchestrator ────────────────────────────────────────────────────
export {
	createJobApplicationAgent,
	createApplicationSubAgentRegistry
} from './orchestrator.agent';

// ── Sub-agents ──────────────────────────────────────────────────────
export { createLinkedInApplicationAgent } from './linkedin.agent';
export { createGreenhouseApplicationAgent } from './greenhouse.agent';
export { createGenericApplicationAgent } from './generic.agent';

// ── Registry ────────────────────────────────────────────────────────
export {
	ApplicationSubAgentRegistry,
	type ApplicationSubAgentEntry
} from './registry';

// ── Types & Schemas ─────────────────────────────────────────────────
export {
	applicationResultSchema,
	applicationFieldSchema,
	applicationRoutingDecisionSchema,
	jobApplicationRequestContextSchema,
	fieldStatusEnum,
	APPLICATION_SITE_AGENT_MAP,
	type ApplicationResult,
	type ApplicationField,
	type ApplicationRoutingDecision,
	type JobApplicationRequestContext,
	type FieldStatus,
	type ApplicationSiteId
} from './types';
