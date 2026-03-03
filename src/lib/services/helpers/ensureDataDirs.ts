// src/lib/services/helpers/ensureDataDirs.ts
//
// Ensures all required data/ subdirectories exist at startup.
// Import this module once from the earliest shared singleton (db.ts) so the
// directories are guaranteed to be present before any service tries to write
// to them.

import fs from 'fs';
import path from 'path';

const REQUIRED_DIRS = [
	path.join('data', 'logs', 'screenshots'),
	path.join('data', 'logs', 'screenshots', 'ad-hoc'),
	path.join('data', 'resumes'),
	path.join('data', 'user-resources')
];

export function ensureDataDirs(): void {
	for (const dir of REQUIRED_DIRS) {
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
	}
}

// Run immediately on import so callers don't need to call the function manually.
ensureDataDirs();
