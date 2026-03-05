// src/lib/services/services/schedulerLogger.ts
// Scheduler logger — writes tagged lines to stdout so they appear in the
// dev server log (data/logs/dev.log via `tee`) alongside DB and general logs.
//
// Every line is prefixed with [scheduler] so the admin log viewer can
// filter by source tag.

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

// ANSI colours — rendered natively by xterm.js in the admin log viewer
const A = {
	reset: '\x1b[0m',
	bold: '\x1b[1m',
	dim: '\x1b[2m',
	gray: '\x1b[90m',
	cyan: '\x1b[36m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	red: '\x1b[31m',
	magenta: '\x1b[35m'
} as const;

const LEVEL_COLOR: Record<LogLevel, string> = {
	DEBUG: A.gray,
	INFO: A.cyan,
	WARN: A.yellow,
	ERROR: A.red
};

function timestamp(): string {
	return new Date().toISOString();
}

function formatArgs(args: unknown[]): string {
	if (args.length === 0) return '';
	return ' ' + args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
}

function writeLine(level: LogLevel, msg: string, args: unknown[]): void {
	const levelColor = LEVEL_COLOR[level];
	const tag = `${A.bold}${A.magenta}[scheduler]${A.reset}`;
	const lvl = `${levelColor}${A.bold}${level}${A.reset}`;
	const ts = `${A.dim}${timestamp()}${A.reset}`;
	const text = `${msg}${formatArgs(args)}`;

	process.stdout.write(`${tag} ${ts} ${lvl} ${text}\n`);
}

/**
 * Logger that implements cronbake's Logger interface and writes tagged lines
 * to stdout. The dev server captures stdout via `tee data/logs/dev.log`, so
 * all scheduler output appears there and can be filtered by the [scheduler]
 * tag in the admin log viewer.
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
