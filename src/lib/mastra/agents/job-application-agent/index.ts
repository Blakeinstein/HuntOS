/**
 * Job Application Agent — barrel export.
 *
 * Exports the unified job application agent factory, the site-instructions
 * resolver for dynamic context injection, and shared types/schemas.
 *
 * The previous multi-agent architecture (orchestrator + site-specific
 * sub-agents + registry) has been replaced by a single central agent
 * that receives site-specific instructions via dynamic context.
 */

// ── Agent ───────────────────────────────────────────────────────────
export { createJobApplicationAgent } from './agent';

// ── Site Instructions ───────────────────────────────────────────────
export {
	resolveSiteInstructions,
	identifySite,
	loadSiteInstructions,
	listKnownSites,
	clearSiteInstructionCache,
	type SiteMatch
} from './site-instructions';

// ── Types & Schemas ─────────────────────────────────────────────────
export {
	applicationResultSchema,
	applicationFieldSchema,
	jobApplicationRequestContextSchema,
	fieldStatusEnum,
	type ApplicationResult,
	type ApplicationField,
	type JobApplicationRequestContext,
	type FieldStatus
} from './types';
