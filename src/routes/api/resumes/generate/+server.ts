// src/routes/api/resumes/generate/+server.ts
// Resume generation API — delegates to the appropriate service based on the
// configured resume format. Both services internally prefer the Mastra agent
// for the LLM step (full Studio observability) and fall back to a direct LLM
// call only when the agent is not yet wired.

import { json } from '@sveltejs/kit';
import { services } from '$lib/mastra';
import type { ResumeData } from '$lib/services/resume/schema';

export async function POST({ request }) {
	const finishAudit = services.auditLogService.start({
		category: 'resume',
		agent_id: null,
		title: 'Resume generation via API',
		detail: 'POST /api/resumes/generate'
	});

	try {
		const { jobDescription, templateId, resumeName, generatePdf = true } = await request.json();

		if (
			!jobDescription ||
			typeof jobDescription !== 'string' ||
			jobDescription.trim().length === 0
		) {
			finishAudit({
				status: 'warning',
				detail: 'Request rejected: missing or empty jobDescription',
				meta: { reason: 'validation' }
			});
			return json({ error: 'jobDescription is required' }, { status: 400 });
		}

		const resumeFormat = services.appSettingsService.resumeFormat;

		if (resumeFormat === 'typst') {
			return await handleTypstGeneration(jobDescription, resumeName, finishAudit);
		}

		return await handleMarkdownGeneration(
			jobDescription,
			templateId,
			resumeName,
			generatePdf,
			finishAudit
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to generate resume';
		console.error('[api/resumes/generate] Error:', message);

		finishAudit({
			status: 'error',
			detail: `Resume generation failed: ${message}`,
			meta: { error: message }
		});

		return json({ error: message }, { status: 500 });
	}
}

// ── Markdown pipeline ────────────────────────────────────────────

async function handleMarkdownGeneration(
	jobDescription: string,
	templateId: number | undefined,
	resumeName: string | undefined,
	generatePdf: boolean,
	finishAudit: ReturnType<typeof services.auditLogService.start>
) {
	const result = await services.resumeGenerationService.generate(
		jobDescription,
		templateId ? Number(templateId) : undefined
	);

	const name = resumeName || deriveResumeName(result.data?.name || 'Resume', jobDescription);

	const historyEntry = services.resumeHistoryService.create({
		name,
		jobDescription,
		templateId: templateId ? Number(templateId) : null,
		templateName: result.templateName,
		model: 'resume-agent',
		data: result.data,
		markdown: result.markdown
	});

	let pdfAvailable = false;
	let pdfPath: string | null = null;

	if (generatePdf) {
		try {
			const pdfResult = await services.resumeHistoryService.generatePdf(historyEntry.id);
			if (pdfResult) {
				pdfAvailable = true;
				pdfPath = pdfResult.entry.pdf_path;
			}
		} catch (pdfError) {
			console.warn(
				'[api/resumes/generate] PDF generation failed (non-critical):',
				pdfError instanceof Error ? pdfError.message : pdfError
			);
		}
	}

	finishAudit({
		status: 'success',
		detail:
			`Resume "${name}" generated using "${result.templateName}" template. ` +
			`Saved as history #${historyEntry.id}.` +
			(pdfAvailable ? ' PDF generated.' : ''),
		meta: {
			format: 'markdown',
			historyId: historyEntry.id,
			filePath: historyEntry.file_path,
			pdfPath,
			pdfAvailable,
			templateName: result.templateName
		}
	});

	return json({
		markdown: result.markdown,
		data: result.data as ResumeData,
		templateName: result.templateName,
		format: 'markdown',
		historyId: historyEntry.id,
		resumeName: historyEntry.name,
		filePath: historyEntry.file_path,
		pdfAvailable,
		pdfPath
	});
}

// ── Typst pipeline ───────────────────────────────────────────────

async function handleTypstGeneration(
	jobDescription: string,
	resumeName: string | undefined,
	finishAudit: ReturnType<typeof services.auditLogService.start>
) {
	const result = await services.typstResumeService.generate(jobDescription);

	const name =
		resumeName || deriveResumeName(result.data.personal.name || 'Resume', jobDescription);

	const historyEntry = services.resumeHistoryService.create({
		name,
		jobDescription,
		templateId: null,
		templateName: result.templateName,
		model: 'resume-agent',
		data: result.data as unknown as ResumeData,
		markdown: result.yaml
	});

	let pdfAvailable = false;
	let pdfPath: string | null = null;

	try {
		const pdfResult = services.resumeHistoryService.persistTypstPdf(
			historyEntry.id,
			result.pdfBuffer
		);
		if (pdfResult) {
			pdfAvailable = true;
			pdfPath = pdfResult.pdf_path;
		}
	} catch (pdfError) {
		console.warn(
			'[api/resumes/generate] Typst PDF persist failed:',
			pdfError instanceof Error ? pdfError.message : pdfError
		);
	}

	const skillCount = result.data.skills.reduce((acc, s) => acc + s.skills.split(',').length, 0);

	finishAudit({
		status: 'success',
		detail:
			`Resume "${name}" generated using "${result.templateName}" template. ` +
			`Skills: ${skillCount}, Experience: ${result.data.experience.length}, ` +
			`Education: ${result.data.education.length}. Saved as history #${historyEntry.id}.`,
		meta: {
			format: 'typst',
			historyId: historyEntry.id,
			filePath: historyEntry.file_path,
			pdfPath,
			pdfAvailable,
			resumeName: name,
			templateName: result.templateName,
			skillCount,
			experienceCount: result.data.experience.length,
			educationCount: result.data.education.length,
			projectCount: result.data.projects?.length ?? 0,
			jobDescriptionLength: jobDescription.length
		}
	});

	return json({
		format: 'typst',
		data: result.data,
		yaml: result.yaml,
		templateName: result.templateName,
		historyId: historyEntry.id,
		resumeName: name,
		filePath: historyEntry.file_path,
		pdfAvailable,
		pdfPath
	});
}

// ── Helpers ──────────────────────────────────────────────────────

function deriveResumeName(candidateName: string, jobDescription: string): string {
	const firstLine = jobDescription.trim().split('\n')[0].trim();
	const snippet = firstLine.length > 60 ? firstLine.slice(0, 57) + '...' : firstLine;

	if (snippet.length > 5) {
		return `${candidateName} - ${snippet}`;
	}

	const dateStr = new Date().toISOString().slice(0, 10);
	return `${candidateName} - Resume ${dateStr}`;
}
