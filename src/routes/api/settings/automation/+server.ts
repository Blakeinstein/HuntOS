// src/routes/api/settings/automation/+server.ts
// API endpoint for reading and updating scheduler/automation settings.
//
// GET  /api/settings/automation  → returns all scheduler settings
// PUT  /api/settings/automation  → updates scheduler settings and reconfigures the scheduler

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { services } from '$lib/mastra';

/** Allowed cron preset values — used for basic validation. */
const CRON_REGEX = /^[@\w*/,-\s]+$/;

/** Validate that a string looks like a cron expression (basic sanity check). */
function isValidCron(value: string): boolean {
	const trimmed = value.trim();
	if (!trimmed) return false;
	if (!CRON_REGEX.test(trimmed)) return false;
	// Standard cron has 5 fields, cronbake also accepts 6 (with seconds)
	const parts = trimmed.split(/\s+/);
	return parts.length >= 5 && parts.length <= 6;
}

export const GET: RequestHandler = async () => {
	const { appSettingsService, schedulerService } = services;

	try {
		const settings = appSettingsService.getSchedulerSettings();
		const jobs = schedulerService.getAllJobStatuses();
		const initialized = schedulerService.isInitialized();

		return json({
			settings,
			scheduler: {
				initialized,
				jobs
			}
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to get automation settings';
		return json({ error: message }, { status: 500 });
	}
};

export const PUT: RequestHandler = async ({ request }) => {
	const { appSettingsService, schedulerService } = services;

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const errors: string[] = [];
	const updated: Record<string, unknown> = {};

	// ── auto_apply_enabled ───────────────────────────────────────
	if ('autoApplyEnabled' in body) {
		const val = body.autoApplyEnabled;
		if (typeof val !== 'boolean') {
			errors.push('"autoApplyEnabled" must be a boolean');
		} else {
			appSettingsService.autoApplyEnabled = val;
			updated.autoApplyEnabled = val;
		}
	}

	// ── scraper_enabled (master toggle — no cron, boards have their own intervals) ─
	if ('scraperEnabled' in body) {
		const val = body.scraperEnabled;
		if (typeof val !== 'boolean') {
			errors.push('"scraperEnabled" must be a boolean');
		} else {
			appSettingsService.scraperEnabled = val;
			updated.scraperEnabled = val;
		}
	}

	// ── audit_cleanup_enabled ────────────────────────────────────
	if ('auditCleanupEnabled' in body) {
		const val = body.auditCleanupEnabled;
		if (typeof val !== 'boolean') {
			errors.push('"auditCleanupEnabled" must be a boolean');
		} else {
			appSettingsService.auditCleanupEnabled = val;
			updated.auditCleanupEnabled = val;
		}
	}

	// ── auto_apply_cron ──────────────────────────────────────────
	if ('autoApplyCron' in body) {
		const val = body.autoApplyCron;
		if (typeof val !== 'string' || !isValidCron(val)) {
			errors.push('"autoApplyCron" must be a valid cron expression');
		} else {
			appSettingsService.autoApplyCron = val.trim();
			updated.autoApplyCron = val.trim();
		}
	}

	// ── auto_apply_batch_size ────────────────────────────────────
	if ('autoApplyBatchSize' in body) {
		const val = body.autoApplyBatchSize;
		const num = typeof val === 'number' ? val : typeof val === 'string' ? parseInt(val, 10) : NaN;
		if (!Number.isFinite(num) || num < 1 || num > 10) {
			errors.push('"autoApplyBatchSize" must be a number between 1 and 10');
		} else {
			appSettingsService.autoApplyBatchSize = num;
			updated.autoApplyBatchSize = num;
		}
	}

	// ── email_sync_cron ──────────────────────────────────────────
	if ('emailSyncCron' in body) {
		const val = body.emailSyncCron;
		if (typeof val !== 'string' || !isValidCron(val)) {
			errors.push('"emailSyncCron" must be a valid cron expression');
		} else {
			appSettingsService.emailSyncCron = val.trim();
			updated.emailSyncCron = val.trim();
		}
	}

	// ── audit_cleanup_cron ───────────────────────────────────────
	if ('auditCleanupCron' in body) {
		const val = body.auditCleanupCron;
		if (typeof val !== 'string' || !isValidCron(val)) {
			errors.push('"auditCleanupCron" must be a valid cron expression');
		} else {
			appSettingsService.auditCleanupCron = val.trim();
			updated.auditCleanupCron = val.trim();
		}
	}

	// If nothing was valid, bail
	if (errors.length > 0 && Object.keys(updated).length === 0) {
		return json({ error: 'No settings were updated', errors }, { status: 400 });
	}

	// Reconfigure the scheduler to pick up the new cron patterns
	let reconfigureResult: { changed: string[] } = { changed: [] };
	try {
		reconfigureResult = await schedulerService.reconfigure();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Scheduler reconfiguration failed';
		return json(
			{
				updated,
				...(errors.length > 0 ? { warnings: errors } : {}),
				reconfigureError: message
			},
			{ status: 200 }
		);
	}

	// Return the updated settings + reconfigure summary
	const settings = appSettingsService.getSchedulerSettings();

	return json({
		updated,
		settings,
		reconfigured: reconfigureResult.changed,
		...(errors.length > 0 ? { warnings: errors } : {})
	});
};
