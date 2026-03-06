// src/lib/mastra/tools/patch-core-tool-builder.ts
//
// Patches Mastra's Agent so that `toModelOutput` survives the
// Tool → CoreTool conversion that happens inside makeCoreTool() /
// CoreToolBuilder.build().
//
// ── Why this is needed ────────────────────────────────────────────────────────
//
// The AI SDK execution path that handles tool results calls:
//
//   createToolModelOutput({ tool: tools[part.toolName], output, ... })
//
// …where `tools` is the map of CoreTool objects produced by makeCoreTool().
// Inside createToolModelOutput, if `tool.toModelOutput` exists it is called to
// transform the raw output into multimodal content (e.g. image-data parts for
// vision tools). If it does NOT exist, the output is serialised as plain JSON.
//
// CoreToolBuilder.build() constructs the CoreTool object with a fixed set of
// properties:
//
//   { type, description, requireApproval, needsApprovalFn, hasSuspendSchema,
//     execute, id, parameters, outputSchema, providerOptions, mcp }
//
// `toModelOutput` is deliberately absent — the type definitions lag behind
// the runtime capability and the builder never got updated to copy it.
//
// As a result, vision tools like browser_screenshot_annotated and
// browser_observe_page attach `toModelOutput` to their Tool instances via
// Object.assign, but that property is silently dropped when makeCoreTool()
// converts them, so the image bytes never reach the model.
//
// ── The fix ───────────────────────────────────────────────────────────────────
//
// CoreToolBuilder is a module-private `var` inside the Mastra bundle — we
// cannot import it or get its prototype directly via standard module APIs.
//
// Instead, we patch Agent.prototype.listAssignedTools, which is the method
// that:
//   1. Calls this.listTools() to get the original Tool objects (which DO have
//      toModelOutput attached via Object.assign).
//   2. Calls makeCoreTool(tool, options) on each to produce CoreTool objects.
//   3. Returns the final { [key]: coreTool } map that the AI SDK receives.
//
// Our wrapper runs the original listAssignedTools, then iterates through the
// original tools (from listTools()) and staples toModelOutput back onto each
// CoreTool object whose original tool had one.
//
// This approach:
//   - Requires no knowledge of CoreToolBuilder internals
//   - Is idempotent (guarded by a patch flag)
//   - Leaves all other CoreTool properties untouched
//   - Works correctly for partial tool sets (tools without toModelOutput are
//     left unchanged)
//   - Survives module hot-reloads in dev (guard re-checks on import)
//
// ── ES-module read-only export caveat ────────────────────────────────────────
//
// makeCoreTool itself is a read-only live-binding export — we cannot replace
// it on the module namespace object. Agent.prototype, however, is a mutable
// object that we CAN patch in-place.

import { Agent } from '@mastra/core/agent';
import { logger } from '../logger';

// ── Patch flag ────────────────────────────────────────────────────────────────

const PATCH_FLAG = Symbol('toModelOutputPatched');

// ── Types ─────────────────────────────────────────────────────────────────────

/** Minimal shape of what we expect back from listTools() */
type OriginalToolMap = Record<string, { toModelOutput?: unknown } | undefined | null>;

/** Minimal shape of what listAssignedTools returns (CoreTool map) */
type CoreToolMap = Record<string, Record<string, unknown>>;

/** The subset of the Agent instance we need inside our wrapper */
interface AgentLike {
	listTools(opts: { requestContext?: unknown }): Promise<OriginalToolMap>;
}

// ── Patch implementation ──────────────────────────────────────────────────────

/**
 * Patches Agent.prototype.listAssignedTools so that any tool whose original
 * Tool instance has a `toModelOutput` function gets that function copied onto
 * the CoreTool object that makeCoreTool() produces.
 *
 * Safe to call multiple times — the patch is applied at most once.
 *
 * @example
 * ```ts
 * // Import this module at app startup (e.g. top of create-agent.ts).
 * // The patch is applied automatically on first import.
 * import '../tools/patch-core-tool-builder';
 * ```
 */
export function patchCoreToolBuilder(): void {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const proto = Agent.prototype as any;

	if (proto[PATCH_FLAG]) {
		// Already patched — idempotent guard.
		return;
	}

	const originalListAssignedTools: (
		this: AgentLike,
		opts: Record<string, unknown>
	) => Promise<CoreToolMap> = proto.listAssignedTools;

	if (typeof originalListAssignedTools !== 'function') {
		logger.warn(
			'[patchCoreToolBuilder] Agent.prototype.listAssignedTools is not a function — ' +
				'toModelOutput will NOT be forwarded to CoreTool objects. ' +
				'Vision tools (browser_screenshot_annotated, browser_observe_page) ' +
				'will return plain JSON instead of image content.'
		);
		return;
	}

	proto.listAssignedTools = async function patchedListAssignedTools(
		this: AgentLike,
		opts: Record<string, unknown>
	): Promise<CoreToolMap> {
		// Run the original to get the converted CoreTool map.
		const coreToolMap = await originalListAssignedTools.call(this, opts);

		// Fetch the original Tool objects — these still have toModelOutput.
		// listTools() is synchronous in practice but typed as async to allow
		// future lazy loading, so we await it.
		let originalTools: OriginalToolMap;
		try {
			originalTools = await this.listTools({ requestContext: opts.requestContext });
		} catch {
			// If listTools fails for any reason, return the unmodified map
			// rather than breaking the agent entirely.
			return coreToolMap;
		}

		// For each key in the CoreTool map, check if the corresponding original
		// tool has a toModelOutput function and staple it onto the CoreTool.
		for (const key of Object.keys(coreToolMap)) {
			const original = originalTools[key];
			if (
				original != null &&
				typeof original === 'object' &&
				typeof original.toModelOutput === 'function'
			) {
				const coreTool = coreToolMap[key];
				if (coreTool != null && typeof coreTool === 'object') {
					coreTool.toModelOutput = original.toModelOutput;
				}
			}
		}

		return coreToolMap;
	};

	// Mark as patched.
	proto[PATCH_FLAG] = true;

	logger.info(
		'[patchCoreToolBuilder] Agent.prototype.listAssignedTools patched — ' +
			'toModelOutput will now be forwarded to all CoreTool objects that have it.'
	);
}

// ── Auto-apply on import ──────────────────────────────────────────────────────
// Run the patch immediately when this module is first imported so callers
// don't need to remember to call patchCoreToolBuilder() manually.
patchCoreToolBuilder();
