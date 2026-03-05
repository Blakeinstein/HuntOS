// src/lib/services/services/schedulerLogger.ts
// File-based logger for the cronbake scheduler.
// Writes structured log lines to data/logs/scheduler.log so the admin
// panel can tail them via the existing SSE log streaming infrastructure.

import { mkdirSync, appendFileSync } from 'fs';
import { resolve, dirname } from 'path';

const LOG_PATH = resolve('data/logs/scheduler.log');

// Ensure the directory exists on module load
mkdirSync(dirname(LOG_PATH), { recursive: true });

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

function timestamp(): string {
	return new Date().toISOString();
}

function formatArgs(args: unknown[]): string {
	if (args.length === 0) return '';
	return ' ' + args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
}

function writeLine(level: LogLevel, msg: string, args: unknown[]): void {
	const line = `[${timestamp()}] [${level}] ${msg}${formatArgs(args)}\n`;
	try {
		appendFileSync(LOG_PATH, line);
	} catch {
		// If we can't write to the log file, fall back to console
		console.error(`[scheduler-logger] Failed to write to ${LOG_PATH}`);
	}
}

/**
 * Logger that implements cronbake's Logger interface and writes to
 * data/logs/scheduler.log. Each line is formatted as:
 *
 *   [ISO_TIMESTAMP] [LEVEL] message ...args
 *
 * The admin panel's SSE log endpoint can tail this file just like
 * dev.log and chrome.log.
 */
export const schedulerLogger = {
	debug(msg: string, ...args: unknown[]): void {
		writeLine('DEBUG', msg, args);
	},
	info(msg: string, ...args: unknown[]): void {
		writeLine('INFO', msg, args);
	},
	warn(msg: string, ...args: unknown[]): void {
		writeLine('WARN', msg, args);
	},
	error(msg: string, ...args: unknown[]): void {
		writeLine('ERROR', msg, args);
	}
};

export { LOG_PATH as SCHEDULER_LOG_PATH };
