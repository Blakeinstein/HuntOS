/**
 * Returns the current UTC time as a proper ISO-8601 string with a `Z` suffix,
 * e.g. `"2024-01-15T10:30:00.000Z"`.
 *
 * Use this everywhere a timestamp needs to be written to SQLite instead of
 * SQLite's `datetime('now')` or `CURRENT_TIMESTAMP`, both of which produce
 * `"YYYY-MM-DD HH:MM:SS"` — a format with no timezone indicator.  Without the
 * `Z`, JavaScript's `Date` constructor behaviour is implementation-defined and
 * many engines treat the string as local time, causing timestamps displayed in
 * the UI to be shifted by the user's UTC offset.
 *
 * Storing `"2024-01-15T10:30:00.000Z"` means:
 *   - SQLite receives and stores the string verbatim (it treats DATETIME as
 *     plain TEXT under the hood, so the format doesn't matter for storage).
 *   - `new Date("2024-01-15T10:30:00.000Z")` is unambiguously UTC in every
 *     spec-compliant JavaScript engine.
 *   - `date.toLocaleString()` then correctly converts to the user's local time.
 */
export function nowIso(): string {
	return new Date().toISOString();
}
