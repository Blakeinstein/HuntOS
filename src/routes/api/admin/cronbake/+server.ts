// src/routes/api/admin/cronbake/+server.ts
// Admin API for reading and writing the cronbake persistence state file.
//
// GET  /api/admin/cronbake  → read data/cronbake-state.json (returns {} if missing)
// PUT  /api/admin/cronbake  → write a new JSON body to data/cronbake-state.json
//                             restarts the scheduler so the new state takes effect
//
// NOTE: After destroy() + init(), we do NOT call start() / bakeAll().
// Cronbake's autoRestore re-creates each job and passes `start: status === "running"`
// directly to the Cron constructor, so jobs with a "running" status in the file
// self-start.  Calling bakeAll() on top of that would also start any intentionally
// "stopped" jobs, defeating the purpose of the file being source of truth.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { services } from '$lib/mastra';

const STATE_PATH = resolve('data/cronbake-state.json');

export const GET: RequestHandler = async () => {
	try {
		if (!existsSync(STATE_PATH)) {
			return json({ _missing: true });
		}

		const raw = readFileSync(STATE_PATH, 'utf-8');
		const parsed = JSON.parse(raw);
		return json(parsed);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to read cronbake state';
		return json({ error: message }, { status: 500 });
	}
};

export const PUT: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		return json({ error: 'Body must be a JSON object' }, { status: 400 });
	}

	try {
		// Ensure the data directory exists
		mkdirSync(dirname(STATE_PATH), { recursive: true });

		const serialized = JSON.stringify(body, null, 2);
		writeFileSync(STATE_PATH, serialized, 'utf-8');

		// Restart the scheduler so cronbake re-reads the state from disk.
		// We do NOT call start() after init() — restored jobs self-start based
		// on their persisted status, and bakeAll() would incorrectly start jobs
		// that were intentionally stopped/removed.
		const { schedulerService } = services;
		if (schedulerService.isInitialized()) {
			await schedulerService.destroy();
			await schedulerService.init();
		}

		return json({ ok: true, message: 'Cronbake state saved and scheduler restarted' });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to write cronbake state';
		return json({ error: message }, { status: 500 });
	}
};
