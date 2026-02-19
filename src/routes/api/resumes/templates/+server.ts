import { json } from '@sveltejs/kit';
import { createServices } from '$lib/services';
import { db } from '$lib/db';

const services = createServices(db);

/**
 * GET /api/resumes/templates — list all resume templates.
 */
export async function GET() {
	try {
		const templates = services.resumeTemplateService.list();
		return json({ templates });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to list templates';
		console.error('[api/resumes/templates] GET error:', message);
		return json({ error: message }, { status: 500 });
	}
}

/**
 * POST /api/resumes/templates — create a new user template.
 * Body: { name: string, content: string }
 */
export async function POST({ request }) {
	try {
		const { name, content } = await request.json();

		if (!name || typeof name !== 'string' || name.trim().length === 0) {
			return json({ error: 'name is required' }, { status: 400 });
		}
		if (!content || typeof content !== 'string' || content.trim().length === 0) {
			return json({ error: 'content is required' }, { status: 400 });
		}

		const template = services.resumeTemplateService.create({
			name: name.trim(),
			content
		});

		return json({ template }, { status: 201 });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to create template';
		console.error('[api/resumes/templates] POST error:', message);
		const status = message.includes('UNIQUE constraint') ? 409 : 500;
		return json({ error: message }, { status });
	}
}

/**
 * PUT /api/resumes/templates — update an existing template.
 * Body: { id: number, name?: string, content?: string }
 */
export async function PUT({ request }) {
	try {
		const { id, name, content, reset } = await request.json();

		if (!id || typeof id !== 'number') {
			return json({ error: 'id is required and must be a number' }, { status: 400 });
		}

		// If reset flag is set, reset the default template to its on-disk version.
		if (reset) {
			const template = services.resumeTemplateService.resetDefault();
			return json({ template });
		}

		const template = services.resumeTemplateService.update(id, {
			...(name != null ? { name } : {}),
			...(content != null ? { content } : {})
		});

		return json({ template });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to update template';
		console.error('[api/resumes/templates] PUT error:', message);
		const status = message.includes('not found') ? 404 : 500;
		return json({ error: message }, { status });
	}
}

/**
 * DELETE /api/resumes/templates — delete a user template.
 * Body: { id: number }
 */
export async function DELETE({ request }) {
	try {
		const { id } = await request.json();

		if (!id || typeof id !== 'number') {
			return json({ error: 'id is required and must be a number' }, { status: 400 });
		}

		services.resumeTemplateService.remove(id);

		return json({ success: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to delete template';
		console.error('[api/resumes/templates] DELETE error:', message);
		const status = message.includes('not found')
			? 404
			: message.includes('Cannot delete')
				? 403
				: 500;
		return json({ error: message }, { status });
	}
}
