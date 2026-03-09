// src/lib/utils/resumeSlug.ts
// Converts a human-readable resume name into a safe kebab-case file stem.
//
// Input examples and expected outputs:
//   "John Doe - Senior Engineer @ Acme Corp"  →  "senior-engineer-acme-corp"
//   "Senior Engineer @ Acme Corp"             →  "senior-engineer-acme-corp"
//   "Acme Corp"                               →  "acme-corp"
//   ""                                        →  "resume"

/**
 * Convert a resume name (as stored in history or entered by the user) into a
 * safe, lowercase, kebab-case file stem suitable for use in download filenames.
 *
 * Strategy:
 *  1. If the name looks like "Candidate Name - <rest>", drop the prefix so the
 *     filename reflects the role/company rather than the candidate's own name.
 *  2. Replace `@`, `/`, `|`, and other separators with spaces.
 *  3. Collapse whitespace and non-alphanumeric characters to hyphens.
 *  4. Trim leading/trailing hyphens and lowercase everything.
 *  5. Fall back to "resume" if nothing remains.
 */
export function resumeFileSlug(name: string): string {
	if (!name || !name.trim()) return 'resume';

	let slug = name.trim();

	// Drop a leading "Candidate Name - " prefix produced by deriveResumeName.
	// Heuristic: if there's " - " in the string, take everything after the first one.
	const dashIdx = slug.indexOf(' - ');
	if (dashIdx !== -1) {
		slug = slug.slice(dashIdx + 3);
	}

	slug = slug
		// Common word separators → space
		.replace(/[@|/\\]+/g, ' ')
		// Any character that isn't alphanumeric or space → space
		.replace(/[^a-zA-Z0-9 ]+/g, ' ')
		// Collapse runs of whitespace → single hyphen
		.trim()
		.replace(/\s+/g, '-')
		.toLowerCase()
		// Collapse multiple hyphens
		.replace(/-{2,}/g, '-')
		// Strip leading/trailing hyphens
		.replace(/^-+|-+$/g, '');

	return slug || 'resume';
}
