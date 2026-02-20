import { json } from '@sveltejs/kit';
import { createServices } from '$lib/services';
import { db } from '$lib/db';
import type { ResumeData } from '$lib/services/resume/schema';

const services = createServices(db);

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

	// Derive a name if none was provided
	const name = resumeName || deriveResumeName(result.data?.name || 'Resume', jobDescription);

	// Save to history (markdown file)
	const historyEntry = services.resumeHistoryService.create({
		name,
		jobDescription,
		templateId: templateId ? Number(templateId) : null,
		templateName: result.templateName,
		model: 'qwen/qwen3-30b-a3b-instruct-2507',
		data: result.data,
		markdown: result.markdown
	});

	// Generate PDF alongside the markdown if requested
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
			// PDF generation is non-critical — log and continue
			console.warn(
				'[api/resumes/generate] PDF generation failed (non-critical):',
				pdfError instanceof Error ? pdfError.message : pdfError
			);
		}
	}

	finishAudit({
		status: 'success',
		detail:
			`Resume "${name}" generated successfully using "${result.templateName}" template (Markdown). ` +
			`Skills: ${result.data.skills.length}, Experience: ${result.data.experience.length}, ` +
			`Education: ${result.data.education.length}. Saved as history #${historyEntry.id}.` +
			(pdfAvailable ? ' PDF generated.' : ''),
		meta: {
			format: 'markdown',
			historyId: historyEntry.id,
			filePath: historyEntry.file_path,
			pdfPath,
			pdfAvailable,
			resumeName: name,
			templateName: result.templateName,
			skillCount: result.data.skills.length,
			experienceCount: result.data.experience.length,
			educationCount: result.data.education.length,
			certificationCount: result.data.certifications.length,
			projectCount: result.data.projects.length,
			jobDescriptionLength: jobDescription.length
		}
	});

	return json({
		...result,
		format: 'markdown',
		historyId: historyEntry.id,
		resumeName: name,
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

	// Save the Typst output to history.
	// We store the YAML as "markdown" content (it's the source format) and
	// persist the PDF directly since Typst produces it natively.
	const historyEntry = services.resumeHistoryService.create({
		name,
		jobDescription,
		templateId: null,
		templateName: result.templateName,
		model: 'qwen/qwen3-30b-a3b-instruct-2507',
		data: result.data as unknown as ResumeData, // TypstResumeData stored as JSON
		markdown: result.yaml // Store YAML as the source content
	});

	// Write the Typst-generated PDF alongside the markdown/yaml file
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
			`Resume "${name}" generated successfully using "${result.templateName}" template (Typst). ` +
			`Skills: ${skillCount}, Experience: ${result.data.experience.length}, ` +
			`Education: ${result.data.education.length}. Saved as history #${historyEntry.id}. PDF generated natively.`,
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

/**
 * Derive a human-readable resume name from the candidate name and job description.
 */
function deriveResumeName(candidateName: string, jobDescription: string): string {
	const firstLine = jobDescription.trim().split('\n')[0].trim();
	const snippet = firstLine.length > 60 ? firstLine.slice(0, 57) + '...' : firstLine;

	if (snippet.length > 5) {
		return `${candidateName} - ${snippet}`;
	}

	const now = new Date();
	const dateStr = now.toISOString().slice(0, 10);
	return `${candidateName} - Resume ${dateStr}`;
}
