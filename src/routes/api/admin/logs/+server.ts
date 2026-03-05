// src/routes/api/admin/logs/+server.ts
// SSE endpoint that streams server log files to the admin panel in real time.
// Supports tailing data/logs/dev.log or data/logs/chrome.log.

import type { RequestHandler } from './$types';
import { existsSync, statSync, openSync, readSync, closeSync } from 'fs';
import { resolve } from 'path';

const LOG_FILES: Record<string, string> = {
	dev: resolve('data/logs/dev.log'),
	chrome: resolve('data/logs/chrome.log')
};

const VALID_SOURCES = new Set(Object.keys(LOG_FILES));
const TAIL_LINES = 200; // lines to send on initial connection
const POLL_INTERVAL_MS = 500;

/**
 * Read the last N lines from a file by scanning backwards from EOF.
 * Returns an empty string if the file doesn't exist or is empty.
 */
function tailFile(filePath: string, lines: number): string {
	if (!existsSync(filePath)) return '';

	const stat = statSync(filePath);
	if (stat.size === 0) return '';

	const fd = openSync(filePath, 'r');
	const chunkSize = Math.min(4096, stat.size);
	const buf = Buffer.alloc(chunkSize);

	let collected = '';
	let pos = stat.size;
	let lineCount = 0;

	while (pos > 0 && lineCount <= lines) {
		const readSize = Math.min(chunkSize, pos);
		pos -= readSize;
		readSync(fd, buf, 0, readSize, pos);
		const chunk = buf.subarray(0, readSize).toString('utf8');
		collected = chunk + collected;
		// Count newlines
		for (let i = 0; i < chunk.length; i++) {
			if (chunk[i] === '\n') lineCount++;
		}
	}

	closeSync(fd);

	const allLines = collected.split('\n');
	// If we read more than needed, trim from the front
	if (allLines.length > lines + 1) {
		return allLines.slice(allLines.length - lines - 1).join('\n');
	}
	return collected;
}

/**
 * GET /api/admin/logs?source=dev
 * Opens an SSE stream. Sends the last TAIL_LINES on connect, then polls
 * for new content by tracking file size.
 *
 * Query params:
 *   source  — one of: dev | studio | chrome  (default: dev)
 */
export const GET: RequestHandler = async ({ url, request }) => {
	const source = url.searchParams.get('source') ?? 'dev';

	if (!VALID_SOURCES.has(source)) {
		return new Response(
			`data: ${JSON.stringify({ error: `Invalid source. Must be one of: ${[...VALID_SOURCES].join(', ')}` })}\n\n`,
			{ status: 400, headers: { 'Content-Type': 'text/event-stream' } }
		);
	}

	const filePath = LOG_FILES[source];

	const stream = new ReadableStream({
		start(controller) {
			let closed = false;
			let knownSize = 0;

			function enqueue(eventName: string, data: string) {
				if (closed) return;
				try {
					controller.enqueue(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
				} catch {
					closed = true;
				}
			}

			function enqueueLines(text: string) {
				if (!text) return;
				// Split into individual lines and send each as a separate message
				// so the client can append line-by-line.
				const lines = text.split('\n');
				for (const line of lines) {
					enqueue('log', line);
				}
			}

			// ── Initial tail ──────────────────────────────────────────────
			const initial = tailFile(filePath, TAIL_LINES);
			enqueueLines(initial);

			// Track file size so we only send new bytes
			knownSize = existsSync(filePath) ? statSync(filePath).size : 0;

			// ── Poll for new content ───────────────────────────────────────
			const pollInterval = setInterval(() => {
				if (closed) {
					clearInterval(pollInterval);
					return;
				}

				if (!existsSync(filePath)) {
					// File doesn't exist yet — nothing to tail
					return;
				}

				const currentSize = statSync(filePath).size;

				if (currentSize < knownSize) {
					// File was rotated / truncated — re-send tail
					knownSize = currentSize;
					const refreshed = tailFile(filePath, TAIL_LINES);
					enqueue('clear', '');
					enqueueLines(refreshed);
					return;
				}

				if (currentSize === knownSize) return;

				// Read only the new bytes
				const newBytes = currentSize - knownSize;
				const buf = Buffer.alloc(newBytes);
				const fd = openSync(filePath, 'r');
				readSync(fd, buf, 0, newBytes, knownSize);
				closeSync(fd);
				knownSize = currentSize;

				const newText = buf.toString('utf8');
				enqueueLines(newText);
			}, POLL_INTERVAL_MS);

			// ── Heartbeat to keep connection alive ─────────────────────────
			const heartbeat = setInterval(() => {
				if (closed) {
					clearInterval(heartbeat);
					return;
				}
				try {
					controller.enqueue(': ping\n\n');
				} catch {
					closed = true;
					clearInterval(heartbeat);
					clearInterval(pollInterval);
				}
			}, 15_000);

			// ── Cleanup when client disconnects ────────────────────────────
			request.signal.addEventListener('abort', () => {
				closed = true;
				clearInterval(pollInterval);
				clearInterval(heartbeat);
				try {
					controller.close();
				} catch {
					// already closed
				}
			});
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
