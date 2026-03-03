// src/lib/mastra/logger.ts
// Shared logger configuration for the Mastra instance and tool hooks

import { PinoLogger } from '@mastra/loggers';

/**
 * Shared PinoLogger instance used by the Mastra runtime.
 *
 * - Console output at "debug" level so we capture everything during development.
 * - Swap to "info" or add a FileTransport / UpstashTransport for production.
 */
export const logger = new PinoLogger({
	name: 'AutoJobApp',
	level: 'debug',
	redact: {
		paths: ['model'], // Redact the "model" field from logs
		remove: true // Completely remove the redacted field
	}
});
