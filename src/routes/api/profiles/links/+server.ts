import { json } from '@sveltejs/kit';
import { createServices } from '$lib/services';
import { db } from '$lib/db';
import type { ProfileLink } from '$lib/services';

const services = createServices(db);

/** GET — return the full links list (seeds defaults if empty). */
export async function GET() {
	try {
		const links = await services.profileService.getProfileLinks();
		return json(links);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to fetch links';
		return json({ error: message }, { status: 500 });
	}
}

/** PUT — replace the entire links list. Body: ProfileLink[] */
export async function PUT({ request }) {
	try {
		const links: ProfileLink[] = await request.json();

		if (!Array.isArray(links)) {
			return json({ error: 'Body must be an array of links' }, { status: 400 });
		}

		for (const link of links) {
			if (!link.id || !link.title) {
				return json(
					{ error: 'Each link must have at least an id and a title' },
					{ status: 400 }
				);
			}
		}

		await services.profileService.saveProfileLinks(links);
		return json(links);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to save links';
		return json({ error: message }, { status: 500 });
	}
}

/** POST — upsert a single link. Body: ProfileLink */
export async function POST({ request }) {
	try {
		const link: ProfileLink = await request.json();

		if (!link.id || !link.title) {
			return json({ error: 'Link must have at least an id and a title' }, { status: 400 });
		}

		const links = await services.profileService.upsertProfileLink(link);
		return json(links);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to upsert link';
		return json({ error: message }, { status: 500 });
	}
}

/** DELETE — remove a link by id (passed as ?id=xxx query param). */
export async function DELETE({ url }) {
	try {
		const id = url.searchParams.get('id');

		if (!id) {
			return json({ error: 'Missing required query param: id' }, { status: 400 });
		}

		const links = await services.profileService.removeProfileLink(id);
		return json(links);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to delete link';
		return json({ error: message }, { status: 500 });
	}
}
