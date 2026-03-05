// src/routes/+page.server.ts
// Home page server load — gathers onboarding progress & dashboard stats

import type { PageServerLoad } from './$types';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

export const load: PageServerLoad = async ({ depends }) => {
	depends('db:profile');
	depends('db:job-boards');
	depends('db:resume-history');

	const services = createServices(db);

	// ── Profile completeness ──────────────────────────────────────────────
	const completeness = await services.profileService.getCompletenessScore();
	const incompleteFields = await services.profileService.getIncompleteFields();
	const profile = await services.profileService.getProfile();
	const profileName = (profile.name as string) ?? '';

	// ── Job boards ────────────────────────────────────────────────────────
	const jobBoards = await services.jobBoardService.getJobBoards();
	const totalJobBoards = jobBoards.length;
	const enabledJobBoards = jobBoards.filter((b) => b.is_enabled).length;

	// ── Applications ──────────────────────────────────────────────────────
	const applications = await services.applicationService.getApplications();
	const totalApplications = applications.length;

	// ── Resume history ────────────────────────────────────────────────────
	const resumeHistory = services.resumeHistoryService.query({ limit: 1, offset: 0 });
	const totalResumes = resumeHistory.total;

	// ── Audit logs ────────────────────────────────────────────────────────
	const auditPage = services.auditLogService.query({ limit: 1, offset: 0 });
	const totalAuditLogs = auditPage.total;

	// ── Resume format ─────────────────────────────────────────────────────
	const resumeFormat = services.appSettingsService.resumeFormat;

	return {
		profileName,
		completeness,
		incompleteFields,
		totalJobBoards,
		enabledJobBoards,
		totalApplications,
		totalResumes,
		totalAuditLogs,
		resumeFormat
	};
};
