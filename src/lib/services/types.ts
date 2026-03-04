/**
 * Client-safe types & constants barrel.
 *
 * Every export here uses `export type` (erased at compile time) so that
 * Vite/Rollup never follows the import into the service file at runtime.
 * This means better-sqlite3 and other Node-only deps are never bundled
 * into the client.
 *
 * Svelte components and stores should import from HERE, never from
 * `$lib/services` or `$lib/services/services/*` directly.
 */

// ── Application ─────────────────────────────────────────────────────

export type {
	Application,
	ApplicationField,
	ApplicationHistory,
	ApplicationWithSwimlane
} from '$lib/services/services/application';

// ── Swimlane ────────────────────────────────────────────────────────

export type { Swimlane } from '$lib/services/services/swimlane';

// ── Profile ─────────────────────────────────────────────────────────

export type {
	ProfileData,
	ProfileKey,
	ProfileLink,
	ProfileUpdate
} from '$lib/services/services/profile';

// ── Pipeline ────────────────────────────────────────────────────────

export type {
	PipelineRun,
	PipelineStatus,
	PipelineStep,
	PipelineStepLog,
	PipelineLogLevel
} from '$lib/services/services/applicationPipeline';

// Re-export runtime constants — these are pure values with no server deps.
// The applicationPipeline module does `import type { Database }` which is
// erased, so the only things that actually execute are these two consts.
export { PIPELINE_STEPS, PIPELINE_STEP_LABELS } from '$lib/services/services/applicationPipeline';

// ── Apply Pipeline Executor ─────────────────────────────────────────

export type { PipelineExecutionResult } from '$lib/services/services/applyPipelineExecutor';

// ── Application Resources ───────────────────────────────────────────

export type {
	ApplicationResource,
	ResourceType,
	CreateResourceOptions
} from '$lib/services/services/applicationResource';

// ── Audit Log ───────────────────────────────────────────────────────

export type {
	AuditLogEntry,
	AuditLogPage,
	AuditLogFilters,
	AuditLogCategory,
	AuditLogStatus
} from '$lib/services/services/auditLog';

// ── Job Board ───────────────────────────────────────────────────────

export type { JobBoardConfig } from '$lib/services/services/jobBoard';
export type { ScrapeJobBoardResult } from '$lib/services/services/jobBoardScraper';

// ── Email Monitor ───────────────────────────────────────────────────

export type { EmailAccount } from '$lib/services/services/emailMonitor';

// ── Documents ───────────────────────────────────────────────────────

export type {
	UserDocument,
	DocumentChunk,
	DocumentSearchResult,
	CreateDocumentOptions,
	DocumentContentType
} from '$lib/services/services/document';

// ── Resume History ──────────────────────────────────────────────────

export type {
	ResumeHistoryEntry,
	ResumeHistoryPage,
	ResumeHistoryFilters,
	CreateResumeHistoryOptions
} from '$lib/services/services/resumeHistory';

// ── Text Extraction ─────────────────────────────────────────────────

export type { ExtractionResult, SupportedFormat } from '$lib/services/services/textExtractor';

// ── PDF / Typst ─────────────────────────────────────────────────────

export type { PdfConversionOptions, PdfConversionResult } from '$lib/services/services/pdfService';

export type { TypstResumeConfig, TypstResumeResult } from '$lib/services/services/typstResume';

// ── App Settings ────────────────────────────────────────────────────────────

export type { ResumeFormat, AppSetting, AppSettingsMap } from '$lib/services/services/appSettings';

// ── Link Summaries ───────────────────────────────────────────────────────────

export type {
	LinkSummary,
	LinkSummaryType,
	LinkSummaryStatus,
	UpsertLinkSummaryOptions
} from '$lib/services/services/linkSummary';

export type {
	LinkSummaryJob,
	QueueState,
	QueueStatus
} from '$lib/services/services/linkSummaryQueue';
