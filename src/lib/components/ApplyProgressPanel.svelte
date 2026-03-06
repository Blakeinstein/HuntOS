<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';

	import {
		LoaderCircleIcon,
		CheckCircleIcon,
		XCircleIcon,
		CircleDotIcon,
		CircleIcon,
		FileTextIcon,
		BuildingIcon,
		BriefcaseIcon,
		AlertTriangleIcon,
		RefreshCwIcon,
		ChevronDownIcon,
		ChevronUpIcon,
		BanIcon,
		InfoIcon,
		AlertCircleIcon,
		MessageSquareIcon,
		ClipboardListIcon,
		ScrollTextIcon,
		CameraIcon,
		XIcon
	} from '@lucide/svelte';
	import type {
		PipelineRun,
		ApplicationResource,
		PipelineStep,
		PipelineStepLog
	} from '$lib/services/types';
	import { PIPELINE_STEPS, PIPELINE_STEP_LABELS } from '$lib/services/types';

	interface ResumeHistoryEntry {
		id: number;
		pdf_path: string | null;
		pdf_exists: boolean;
	}

	interface Props {
		applicationId: number;
		pipelineRuns: PipelineRun[];
		latestRun: PipelineRun | null;
		resources: ApplicationResource[];
		isBacklog: boolean;
		initialStepLogs?: PipelineStepLog[];
		resumeHistoryEntry?: ResumeHistoryEntry | null;
		onApply?: () => void;
		onResumeFrom?: (step: PipelineStep) => void;
	}

	let {
		applicationId,
		pipelineRuns,
		latestRun,
		resources,
		isBacklog,
		initialStepLogs = [],
		resumeHistoryEntry = null,
		onApply,
		onResumeFrom
	}: Props = $props();

	const resumePdfAdminUrl = $derived(
		resumeHistoryEntry?.pdf_exists && resumeHistoryEntry.pdf_path
			? `/settings/admin?tab=files&bucket=resumes&file=${encodeURIComponent(resumeHistoryEntry.pdf_path.split('/').pop() ?? '')}`
			: null
	);

	const LOG_TRUNCATE_LENGTH = 200;

	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let expandedResources = new SvelteSet<number>();
	let expandedSteps = new SvelteSet<string>();
	let expandedLogs = new SvelteSet<number>();
	let expandedScreenshots = new SvelteSet<number>();
	let lightboxSrc: string | null = $state(null);
	let localLatestRun = $state<PipelineRun | null>(null);
	let localResources = $state<ApplicationResource[]>([]);
	let stepLogs = $state<PipelineStepLog[]>([]);
	let lastLogId = $state(0);
	let seeded = false;
	let isCancelling = $state(false);
	let cancelError = $state<string | null>(null);
	let trackedRunId = $state<number | null>(null);

	// Seed step logs from the SSR prop exactly once on mount
	$effect(() => {
		if (!seeded && initialStepLogs.length > 0) {
			seeded = true;
			stepLogs = initialStepLogs;
			lastLogId = initialStepLogs[initialStepLogs.length - 1].id;
		}
	});

	// Reset local state when the latestRun prop changes to a new run
	// (e.g. after a retry triggers invalidate and a new pipeline run is created).
	$effect(() => {
		const incomingId = latestRun?.id ?? null;
		if (incomingId !== null && incomingId !== trackedRunId) {
			trackedRunId = incomingId;
			localLatestRun = null;
			localResources = [];
			stepLogs = [];
			lastLogId = 0;
			seeded = false;
			isCancelling = false;
			cancelError = null;
			expandedSteps.clear();
			expandedResources.clear();
			expandedLogs.clear();
		}
	});

	// Use local state if we've been polling, otherwise use props
	const activeRun = $derived(localLatestRun ?? latestRun);
	const activeResources = $derived(localResources.length > 0 ? localResources : resources);

	const isRunning = $derived(activeRun?.status === 'running');
	const isCompleted = $derived(activeRun?.status === 'completed');
	const isFailed = $derived(activeRun?.status === 'failed');
	const isCancelled = $derived(activeRun?.status === 'cancelled');
	const hasRun = $derived(activeRun !== null);

	/**
	 * The step the pipeline failed or was cancelled on.
	 * Used to offer a "Resume from here" button instead of a full restart.
	 */
	const failedStep = $derived.by((): PipelineStep | null => {
		if (!activeRun) return null;
		if (activeRun.status !== 'failed' && activeRun.status !== 'cancelled') return null;
		// current_step is the step that was active when the failure happened
		return activeRun.current_step ?? null;
	});

	/**
	 * Whether we can offer a "resume" option (as opposed to only full retry).
	 * We can resume if the failed step is NOT the very first step — if it
	 * failed on research there's nothing to skip.
	 */
	const canResume = $derived(failedStep !== null && PIPELINE_STEPS.indexOf(failedStep) > 0);

	// Group step logs by step name
	const logsByStep = $derived.by(() => {
		const map: Record<string, PipelineStepLog[]> = {};
		for (const step of PIPELINE_STEPS) {
			map[step] = [];
		}
		for (const log of stepLogs) {
			if (!map[log.step]) map[log.step] = [];
			map[log.step].push(log);
		}
		return map;
	});

	// Auto-expand the currently active step
	$effect(() => {
		if (activeRun?.current_step && isRunning) {
			expandedSteps.add(activeRun.current_step);
		}
	});

	// Start / stop polling based on run status.
	$effect(() => {
		if (isRunning) {
			if (!pollTimer) {
				pollTimer = setInterval(pollStatus, 1500);
			}
		} else {
			if (pollTimer) {
				clearInterval(pollTimer);
				pollTimer = null;
			}
		}

		return () => {
			if (pollTimer) {
				clearInterval(pollTimer);
				pollTimer = null;
			}
		};
	});

	// Load full logs when the run changes (e.g. navigating back to an existing run)
	$effect(() => {
		if (activeRun && !isRunning && stepLogs.length === 0) {
			loadFullLogs();
		}
	});

	async function loadFullLogs() {
		if (!activeRun) return;
		try {
			const response = await fetch(`/api/applications/${applicationId}/pipeline`);
			if (!response.ok) return;
			const data = await response.json();
			if (data.stepLogs) {
				stepLogs = data.stepLogs;
				if (stepLogs.length > 0) {
					lastLogId = stepLogs[stepLogs.length - 1].id;
				}
			}
		} catch {
			// Silently handle
		}
	}

	async function pollStatus() {
		try {
			const url = new URL(`/api/applications/${applicationId}/pipeline`, window.location.origin);
			if (lastLogId > 0) {
				url.searchParams.set('afterLogId', String(lastLogId));
			}

			const response = await fetch(url.toString());
			if (!response.ok) return;

			const data = await response.json();
			localLatestRun = data.pipelineRun;
			localResources = data.resources ?? [];

			// Append new step logs incrementally
			if (data.stepLogs && data.stepLogs.length > 0) {
				if (lastLogId === 0) {
					// First poll — full load
					stepLogs = data.stepLogs;
				} else {
					// Incremental — append new logs
					stepLogs = [...stepLogs, ...data.stepLogs];
				}
				lastLogId = data.stepLogs[data.stepLogs.length - 1].id;
			}

			if (data.pipelineRun && !['running', 'pending'].includes(data.pipelineRun.status)) {
				if (pollTimer) {
					clearInterval(pollTimer);
					pollTimer = null;
				}
				// Reset cancelling state
				isCancelling = false;
			}
		} catch {
			// Silently handle polling errors
		}
	}

	async function handleCancel() {
		if (isCancelling) return;
		isCancelling = true;
		cancelError = null;

		try {
			const response = await fetch(`/api/applications/${applicationId}/pipeline/cancel`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' }
			});

			const data = await response.json();

			if (!response.ok) {
				cancelError = data.error ?? 'Failed to cancel pipeline';
				isCancelling = false;
			}
			// Keep isCancelling true until the next poll confirms cancellation
		} catch (err) {
			cancelError = err instanceof Error ? err.message : 'Failed to cancel pipeline';
			isCancelling = false;
		}
	}

	function getStepStatus(
		step: PipelineStep
	): 'completed' | 'active' | 'pending' | 'error' | 'cancelled' {
		if (!activeRun) return 'pending';

		if (activeRun.steps_completed.includes(step)) return 'completed';
		if (activeRun.current_step === step) {
			if (isFailed) return 'error';
			if (isCancelled) return 'cancelled';
			return 'active';
		}

		// If the run failed/cancelled and this step hasn't been reached
		if (isFailed || isCancelled) {
			const stepIndex = PIPELINE_STEPS.indexOf(step);
			const currentStepIndex = activeRun.current_step
				? PIPELINE_STEPS.indexOf(activeRun.current_step)
				: -1;
			if (stepIndex > currentStepIndex) return 'pending';
		}

		return 'pending';
	}

	function toggleStep(step: string) {
		if (expandedSteps.has(step)) {
			expandedSteps.delete(step);
		} else {
			expandedSteps.add(step);
		}
	}

	function toggleResource(id: number) {
		if (expandedResources.has(id)) {
			expandedResources.delete(id);
		} else {
			expandedResources.add(id);
		}
	}

	function getResourceIcon(type: string) {
		switch (type) {
			case 'job_description':
				return FileTextIcon;
			case 'company_info':
				return BuildingIcon;
			case 'role_research':
				return BriefcaseIcon;
			case 'resume':
				return FileTextIcon;
			case 'error':
				return AlertTriangleIcon;
			case 'form_fields':
				return ClipboardListIcon;
			default:
				return FileTextIcon;
		}
	}

	function getResourceBadgeColor(type: string): string {
		switch (type) {
			case 'job_description':
				return 'bg-primary-500/15 text-primary-500';
			case 'company_info':
				return 'bg-secondary-500/15 text-secondary-500';
			case 'role_research':
				return 'bg-tertiary-500/15 text-tertiary-500';
			case 'resume':
				return 'bg-success-500/15 text-success-500';
			case 'error':
				return 'bg-error-500/15 text-error-500';
			case 'form_fields':
				return 'bg-warning-500/15 text-warning-500';
			default:
				return 'bg-surface-500/15 text-surface-500';
		}
	}

	function formatResourceType(type: string): string {
		return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
	}

	function getLogIcon(level: string) {
		switch (level) {
			case 'error':
				return XCircleIcon;
			case 'warn':
				return AlertCircleIcon;
			case 'progress':
				return CheckCircleIcon;
			default:
				return InfoIcon;
		}
	}

	function getLogColor(level: string): string {
		switch (level) {
			case 'error':
				return 'text-error-500';
			case 'warn':
				return 'text-warning-500';
			case 'progress':
				return 'text-primary-500';
			default:
				return 'opacity-50';
		}
	}

	/**
	 * Check if a step log entry has an associated screenshot path in its meta.
	 */
	function hasScreenshot(log: PipelineStepLog): boolean {
		return typeof log.meta?.screenshotPath === 'string' && log.meta.screenshotPath.length > 0;
	}

	/**
	 * Build the URL to serve a screenshot via the admin screenshots API.
	 *
	 * The screenshotPath stored in meta is relative to cwd, e.g.
	 *   "data/logs/screenshots/Company-42/Title/step-001-browser-click.png"
	 *
	 * The API expects `?run=<runDir>&file=<filename>` where runDir is the
	 * path under data/logs/screenshots/ and filename is relative within it.
	 */
	function screenshotUrl(screenshotPath: string): string {
		// Strip the "data/logs/screenshots/" prefix to get the run-relative path
		const prefix = 'data/logs/screenshots/';
		const relative = screenshotPath.startsWith(prefix)
			? screenshotPath.slice(prefix.length)
			: screenshotPath;

		// Split into run directory (first two segments: company-id/title) and filename
		const parts = relative.split('/');
		if (parts.length >= 3) {
			const run = parts.slice(0, -1).join('/');
			const file = parts[parts.length - 1];
			return `/api/admin/screenshots?run=${encodeURIComponent(run)}&file=${encodeURIComponent(file)}`;
		}

		// Fallback: treat entire path as the file within root
		return `/api/admin/screenshots?run=&file=${encodeURIComponent(relative)}`;
	}

	function formatTime(dateStr: string): string {
		return new Date(dateStr).toLocaleTimeString('en-US', {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}
</script>

<div class="space-y-5">
	<!-- Pipeline status header -->
	{#if !hasRun && isBacklog}
		<div class="card border border-surface-200-800 bg-surface-50-950 p-5">
			<div class="flex items-center justify-between">
				<div>
					<h2 class="text-sm font-bold">Ready to Apply</h2>
					<p class="mt-1 text-xs opacity-60">
						Start the automated apply pipeline to research, generate a resume, and submit your
						application.
					</p>
				</div>
				<button
					type="button"
					class="btn gap-2 preset-filled-primary-500"
					onclick={() => onApply?.()}
				>
					<BriefcaseIcon class="size-4" />
					<span>Apply Now</span>
				</button>
			</div>
		</div>
	{:else if !hasRun}
		<div
			class="flex items-center justify-center card border border-surface-200-800 bg-surface-50-950 p-10"
		>
			<div class="text-center">
				<CircleDotIcon class="mx-auto size-8 opacity-30" />
				<p class="mt-2 text-sm opacity-50">No apply pipeline runs yet.</p>
				<p class="mt-1 text-xs opacity-40">
					Move this application to Backlog to enable auto-apply.
				</p>
			</div>
		</div>
	{/if}

	<!-- Pipeline steps progress -->
	{#if hasRun}
		<div class="card border border-surface-200-800 bg-surface-50-950 p-5">
			<!-- Status header -->
			<div class="mb-4 flex items-center justify-between">
				<div class="flex items-center gap-2">
					{#if isRunning}
						<LoaderCircleIcon class="size-5 animate-spin text-primary-500" />
						<h2 class="text-sm font-bold text-primary-500">Pipeline Running</h2>
					{:else if isCompleted}
						<CheckCircleIcon class="size-5 text-success-500" />
						<h2 class="text-sm font-bold text-success-500">Pipeline Completed</h2>
					{:else if isFailed}
						<XCircleIcon class="size-5 text-error-500" />
						<h2 class="text-sm font-bold text-error-500">Pipeline Failed</h2>
					{:else if isCancelled}
						<BanIcon class="size-5 text-warning-500" />
						<h2 class="text-sm font-bold text-warning-500">Pipeline Cancelled</h2>
					{/if}
				</div>
				<div class="flex items-center gap-2">
					{#if activeRun?.started_at}
						<span class="text-xs opacity-50">
							Started {new Date(activeRun.started_at).toLocaleString()}
						</span>
					{/if}
					{#if isRunning}
						<button
							type="button"
							class="btn-icon preset-filled-error-500"
							title={isCancelling ? 'Cancelling…' : 'Cancel pipeline'}
							disabled={isCancelling}
							onclick={handleCancel}
						>
							{#if isCancelling}
								<LoaderCircleIcon class="size-4 animate-spin" />
							{:else}
								<BanIcon class="size-4" />
							{/if}
						</button>
					{/if}
				</div>
			</div>

			{#if cancelError}
				<div class="mb-4 rounded-md border border-error-500/30 bg-error-500/10 p-2">
					<p class="text-xs text-error-500">{cancelError}</p>
				</div>
			{/if}

			<!-- Steps -->
			<div class="space-y-1">
				{#each PIPELINE_STEPS as step, i (step)}
					{@const status = getStepStatus(step)}
					{@const isLast = i === PIPELINE_STEPS.length - 1}
					{@const logs = logsByStep[step] ?? []}
					{@const isExpanded = expandedSteps.has(step)}
					{@const hasLogs = logs.length > 0}

					<div class="flex items-start gap-3">
						<!-- Step indicator -->
						<div class="flex flex-col items-center">
							<div
								class="flex size-8 items-center justify-center rounded-full {status === 'completed'
									? 'bg-success-500/20'
									: status === 'active'
										? 'bg-primary-500/20'
										: status === 'error'
											? 'bg-error-500/20'
											: status === 'cancelled'
												? 'bg-warning-500/20'
												: 'bg-surface-200-800'}"
							>
								{#if status === 'completed'}
									<CheckCircleIcon class="size-4 text-success-500" />
								{:else if status === 'active'}
									<LoaderCircleIcon class="size-4 animate-spin text-primary-500" />
								{:else if status === 'error'}
									<XCircleIcon class="size-4 text-error-500" />
								{:else if status === 'cancelled'}
									<BanIcon class="size-4 text-warning-500" />
								{:else}
									<CircleIcon class="size-4 opacity-30" />
								{/if}
							</div>
							{#if !isLast}
								<div
									class="mt-1 w-px {status === 'completed'
										? 'bg-success-500/40'
										: 'bg-surface-300-700'} {isExpanded && hasLogs ? 'h-full' : 'h-6'}"
								></div>
							{/if}
						</div>

						<!-- Step content -->
						<div class="min-w-0 flex-1 pb-2">
							<!-- Step header (clickable to expand logs) -->
							<button
								type="button"
								class="flex w-full items-center gap-2 text-left"
								onclick={() => toggleStep(step)}
								disabled={!hasLogs}
							>
								<p
									class="flex-1 text-sm font-semibold {status === 'completed'
										? 'text-success-500'
										: status === 'active'
											? 'text-primary-500'
											: status === 'error'
												? 'text-error-500'
												: status === 'cancelled'
													? 'text-warning-500'
													: 'opacity-50'}"
								>
									{PIPELINE_STEP_LABELS[step]}
								</p>
								{#if hasLogs}
									<span class="flex items-center gap-1 text-[10px] opacity-40">
										<MessageSquareIcon class="size-3" />
										{logs.length}
									</span>
									{#if isExpanded}
										<ChevronUpIcon class="size-3.5 opacity-40" />
									{:else}
										<ChevronDownIcon class="size-3.5 opacity-40" />
									{/if}
								{/if}
							</button>

							<!-- Step status text -->
							{#if status === 'active'}
								{@const lastLog = logs[logs.length - 1]}
								{#if lastLog}
									<p class="mt-0.5 text-xs text-primary-500/80">{lastLog.message}</p>
								{:else}
									<p class="mt-0.5 text-xs opacity-60">In progress…</p>
								{/if}
							{:else if status === 'completed'}
								{@const lastLog = logs[logs.length - 1]}
								<p class="mt-0.5 text-xs opacity-50">
									{lastLog ? lastLog.message : 'Done'}
								</p>
							{:else if status === 'error'}
								<p class="mt-0.5 text-xs text-error-500">
									{activeRun?.error_message ?? 'An error occurred'}
								</p>
							{:else if status === 'cancelled'}
								<p class="mt-0.5 text-xs text-warning-500">Cancelled by user</p>
							{/if}

							<!-- Expanded step logs -->
							{#if isExpanded && hasLogs}
								<div
									class="mt-2 max-h-96 space-y-0.5 overflow-y-auto rounded-md border border-surface-200-800 bg-surface-100-900 p-2"
								>
									{#each logs as log (log.id)}
										{@const LogIcon = getLogIcon(log.level)}
										{@const isLongLog = log.message.length > LOG_TRUNCATE_LENGTH}
										{@const isLogExpanded = expandedLogs.has(log.id)}
										<div class="flex items-start gap-1.5 py-0.5">
											<LogIcon class="mt-px size-3 shrink-0 {getLogColor(log.level)}" />
											<div class="min-w-0 flex-1">
												<div class="flex items-start gap-1">
													<p
														class="flex-1 text-[11px] leading-relaxed {getLogColor(log.level)}"
														class:whitespace-pre-wrap={isLogExpanded}
													>
														{#if isLongLog && !isLogExpanded}
															{log.message.slice(0, LOG_TRUNCATE_LENGTH)}…
															<button
																type="button"
																class="ml-1 inline text-[10px] underline opacity-60 hover:opacity-100"
																onclick={() => expandedLogs.add(log.id)}
															>
																show more
															</button>
														{:else}
															{log.message}
															{#if isLongLog}
																<button
																	type="button"
																	class="ml-1 inline text-[10px] underline opacity-60 hover:opacity-100"
																	onclick={() => expandedLogs.delete(log.id)}
																>
																	show less
																</button>
															{/if}
														{/if}
													</p>
													{#if hasScreenshot(log)}
														<button
															type="button"
															class="shrink-0 rounded p-0.5 opacity-40 transition-opacity hover:opacity-80"
															title="View screenshot"
															onclick={() => {
																if (expandedScreenshots.has(log.id)) {
																	expandedScreenshots.delete(log.id);
																} else {
																	expandedScreenshots.add(log.id);
																}
															}}
														>
															<CameraIcon class="size-3" />
														</button>
													{/if}
												</div>
												{#if hasScreenshot(log) && expandedScreenshots.has(log.id)}
													{@const src = screenshotUrl(log.meta?.screenshotPath as string)}
													<button
														type="button"
														class="mt-1 block cursor-zoom-in overflow-hidden rounded border border-surface-200-800"
														onclick={() => (lightboxSrc = src)}
													>
														<img
															{src}
															alt="Screenshot after {log.meta?.toolId ?? 'action'}"
															class="max-h-32 w-full object-contain"
															loading="lazy"
														/>
													</button>
												{/if}
											</div>
											<span class="shrink-0 text-[9px] tabular-nums opacity-30">
												{formatTime(log.created_at)}
											</span>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>

			<!-- Error message -->
			{#if isFailed && activeRun?.error_message}
				<div class="mt-4 rounded-md border border-error-500/30 bg-error-500/10 p-3">
					<div class="flex items-start gap-2">
						<AlertTriangleIcon class="mt-0.5 size-4 shrink-0 text-error-500" />
						<div>
							<p class="text-xs font-semibold text-error-500">Error Details</p>
							<p class="mt-1 text-xs opacity-80">{activeRun.error_message}</p>
						</div>
					</div>
				</div>
			{/if}

			<!-- Action buttons for terminal states -->
			{#if (isFailed || isCancelled) && isBacklog}
				<div class="mt-4 flex items-center justify-end gap-2">
					{#if canResume && failedStep}
						<button
							type="button"
							class="btn gap-2 preset-filled-primary-500 btn-sm"
							onclick={() => onResumeFrom?.(failedStep)}
							title="Resume from the step that failed, skipping already-completed steps"
						>
							<RefreshCwIcon class="size-3.5" />
							<span>Resume from {PIPELINE_STEP_LABELS[failedStep]}</span>
						</button>
					{/if}
					<button
						type="button"
						class="btn gap-2 preset-filled-warning-500 btn-sm"
						onclick={() => onApply?.()}
					>
						<RefreshCwIcon class="size-3.5" />
						<span>Retry All</span>
					</button>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Resources gathered -->
	{#if activeResources.length > 0}
		<div class="space-y-3">
			<h3 class="text-xs font-bold tracking-wider uppercase opacity-60">Resources</h3>

			{#each activeResources as resource (resource.id)}
				{@const ResourceIcon = getResourceIcon(resource.resource_type)}
				{@const isExpanded = expandedResources.has(resource.id)}
				<div class="card border border-surface-200-800 bg-surface-50-950">
					<div class="flex w-full items-center gap-3 p-3">
						<!-- Expand/collapse clickable area -->
						<button
							type="button"
							class="flex min-w-0 flex-1 items-center gap-3 text-left hover:opacity-80"
							onclick={() => toggleResource(resource.id)}
						>
							<ResourceIcon class="size-4 shrink-0 opacity-50" />
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-semibold">{resource.title}</p>
								<div class="mt-0.5 flex items-center gap-2">
									<span
										class="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium {getResourceBadgeColor(
											resource.resource_type
										)}"
									>
										{formatResourceType(resource.resource_type)}
									</span>
									<span class="text-[10px] opacity-40">
										{new Date(resource.created_at).toLocaleTimeString()}
									</span>
								</div>
							</div>
							{#if isExpanded}
								<ChevronUpIcon class="size-4 shrink-0 opacity-40" />
							{:else}
								<ChevronDownIcon class="size-4 shrink-0 opacity-40" />
							{/if}
						</button>

						<!-- PDF link (outside expand button to avoid button-in-button) -->
						{#if resource.resource_type === 'resume' && resumePdfAdminUrl}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
							<a
								href={resumePdfAdminUrl}
								rel="external"
								class="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary-500/15 px-2 py-0.5 text-[10px] font-medium text-primary-500 transition-colors hover:bg-primary-500/25"
								title="View PDF in Data Files"
							>
								<ScrollTextIcon class="size-2.5" />
								View PDF
							</a>
						{/if}
					</div>

					{#if isExpanded}
						<div class="border-t border-surface-200-800 p-3">
							<pre
								class="max-h-64 overflow-auto rounded-md bg-surface-100-900 p-3 text-xs leading-relaxed whitespace-pre-wrap">{resource.content}</pre>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<!-- Previous runs -->
	{#if pipelineRuns.length > 1}
		<div class="space-y-2">
			<h3 class="text-xs font-bold tracking-wider uppercase opacity-60">Previous Runs</h3>
			{#each pipelineRuns.slice(1) as run (run.id)}
				<div
					class="flex items-center gap-3 card border border-surface-200-800 bg-surface-50-950 p-3"
				>
					{#if run.status === 'completed'}
						<CheckCircleIcon class="size-4 shrink-0 text-success-500" />
					{:else if run.status === 'failed'}
						<XCircleIcon class="size-4 shrink-0 text-error-500" />
					{:else if run.status === 'cancelled'}
						<BanIcon class="size-4 shrink-0 text-warning-500" />
					{:else}
						<CircleDotIcon class="size-4 shrink-0 opacity-40" />
					{/if}
					<div class="min-w-0 flex-1">
						<p class="text-xs font-semibold capitalize">{run.status}</p>
						{#if run.error_message}
							<p class="mt-0.5 truncate text-[10px] text-error-500">{run.error_message}</p>
						{/if}
					</div>
					<span class="text-[10px] opacity-40">
						{new Date(run.created_at).toLocaleDateString()}
					</span>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Screenshot lightbox overlay (portal-style, outside all loops) -->
{#if lightboxSrc}
	<div
		role="dialog"
		aria-label="Screenshot preview"
		aria-modal="true"
		tabindex="-1"
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
		onclick={() => (lightboxSrc = null)}
		onkeydown={(e) => {
			if (e.key === 'Escape') lightboxSrc = null;
		}}
	>
		<button
			type="button"
			class="absolute top-4 right-4 rounded-full bg-surface-900/80 p-2 text-white hover:bg-surface-700"
			onclick={(e) => {
				e.stopPropagation();
				lightboxSrc = null;
			}}
		>
			<XIcon class="size-5" />
		</button>
		<img
			src={lightboxSrc}
			alt="Screenshot preview"
			role="presentation"
			class="max-h-[90vh] max-w-[90vw] rounded-lg shadow-2xl"
		/>
	</div>
{/if}
