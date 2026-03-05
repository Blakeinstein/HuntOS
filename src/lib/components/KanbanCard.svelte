<script lang="ts">
	import { resolve } from '$app/paths';
	import { invalidate } from '$app/navigation';
	import {
		BriefcaseIcon,
		BuildingIcon,
		CalendarIcon,
		ExternalLinkIcon,
		PlayIcon,
		LoaderCircleIcon
	} from '@lucide/svelte';
	import type { ApplicationWithSwimlane, PipelineRun } from '$lib/services/types';
	import ApplyConflictDialog from './ApplyConflictDialog.svelte';

	interface Props {
		application: ApplicationWithSwimlane;
		activePipelineRun: PipelineRun | null;
		isDragging: boolean;
		onDragStart: (event: DragEvent) => void;
		onDragEnd: () => void;
	}

	let { application, activePipelineRun, isDragging, onDragStart, onDragEnd }: Props = $props();

	let isApplying = $state(false);
	let applyError = $state<string | null>(null);

	// Conflict state — shown when another pipeline is already running
	interface ConflictInfo {
		activeApplicationId: number;
		activeRunId: number;
		activeCompany: string;
		activeTitle: string;
	}
	let conflict = $state<ConflictInfo | null>(null);

	// Queue state — polling until the active run finishes
	let isQueued = $state(false);
	let queuePollInterval = $state<ReturnType<typeof setInterval> | null>(null);

	const isBacklog = $derived(application.swimlane_name.toLowerCase() === 'backlog');
	const isInProgress = $derived(application.swimlane_name.toLowerCase() === 'in progress');

	// True if there is a live (running or pending) pipeline attached to this card.
	const hasActivePipeline = $derived(
		activePipelineRun !== null &&
			(activePipelineRun.status === 'running' || activePipelineRun.status === 'pending')
	);

	// Human-readable label for the current pipeline step.
	const activePipelineStepLabel = $derived.by(() => {
		if (!hasActivePipeline || !activePipelineRun?.current_step) return 'Processing…';
		switch (activePipelineRun.current_step) {
			case 'research':
				return 'Researching…';
			case 'resume':
				return 'Generating resume…';
			case 'apply':
				return 'Applying…';
			default:
				return 'Processing…';
		}
	});

	const formattedDate = $derived(
		new Date(application.created_at).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric'
		})
	);

	const missingFieldsCount = $derived(
		application.fields?.filter((f) => f.status === 'missing' || f.status === 'user_input_required')
			.length ?? 0
	);

	// ── Apply helpers ───────────────────────────────────────────────

	async function startApply(action?: 'cancel-and-start') {
		isApplying = true;
		applyError = null;

		try {
			const body: Record<string, unknown> = {};
			if (action) body.action = action;

			const response = await fetch(`/api/applications/${application.id}/apply`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});

			const data = await response.json();

			if (response.status === 409 && data.conflict) {
				// Another pipeline is running — show the conflict dialog
				conflict = {
					activeApplicationId: data.activeApplicationId,
					activeRunId: data.activeRunId,
					activeCompany: data.activeCompany,
					activeTitle: data.activeTitle
				};
				return;
			}

			if (!response.ok) {
				applyError = data.error ?? 'Failed to start apply pipeline';
				return;
			}

			// Navigate to the application detail page to see progress
			window.location.href = resolve(`/applications/${application.id}`);
		} catch (err) {
			applyError = err instanceof Error ? err.message : 'Failed to start apply pipeline';
		} finally {
			isApplying = false;
		}
	}

	function handleApply(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		if (isApplying || isQueued) return;
		startApply();
	}

	// ── Conflict dialog callbacks ───────────────────────────────────

	function handleConflictClose() {
		conflict = null;
	}

	function handleConflictCancelAndStart() {
		conflict = null;
		startApply('cancel-and-start');
	}

	function handleConflictQueue() {
		conflict = null;
		isQueued = true;
		startQueuePolling();
	}

	// ── Queue polling ───────────────────────────────────────────────
	// Poll by re-attempting the apply POST every 3 seconds.
	// A 409 with conflict=true means still busy; anything else means we can proceed.

	function startQueuePolling() {
		if (queuePollInterval !== null) return;

		queuePollInterval = setInterval(async () => {
			try {
				const probe = await fetch(`/api/applications/${application.id}/apply`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({})
				});

				const data = await probe.json();

				if (probe.status === 409 && data.conflict) {
					// Still busy — keep polling
					return;
				}

				// No longer blocked — stop polling
				stopQueuePolling();

				if (probe.ok) {
					// Pipeline started — navigate to progress page
					isQueued = false;
					await invalidate('db:applications');
					await invalidate('db:pipelines');
					window.location.href = resolve(`/applications/${application.id}`);
				} else {
					isQueued = false;
					applyError = data.error ?? 'Failed to start apply pipeline';
				}
			} catch {
				// Network error — keep trying
			}
		}, 3000);
	}

	function stopQueuePolling() {
		if (queuePollInterval !== null) {
			clearInterval(queuePollInterval);
			queuePollInterval = null;
		}
	}

	function handleCancelQueue(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		isQueued = false;
		stopQueuePolling();
	}
</script>

<a
	href={resolve(`/applications/${application.id}`)}
	class="block cursor-grab card rounded-md border bg-surface-50-950 p-3 shadow-sm transition-all hover:shadow-md active:cursor-grabbing"
	class:opacity-40={isDragging}
	class:ring-2={isDragging}
	class:ring-primary-500={isDragging}
	class:border-tertiary-400={hasActivePipeline}
	class:border-surface-200-800={!hasActivePipeline}
	class:hover:border-primary-500={!hasActivePipeline}
	class:hover:border-tertiary-300={hasActivePipeline}
	draggable="true"
	ondragstart={onDragStart}
	ondragend={onDragEnd}
>
	<!-- Active pipeline indicator banner -->
	{#if hasActivePipeline}
		<div
			class="mb-2 flex items-center gap-1.5 rounded bg-tertiary-500/10 px-2 py-1 text-tertiary-600 dark:text-tertiary-400"
		>
			<LoaderCircleIcon class="size-3 shrink-0 animate-spin" />
			<span class="text-[10px] font-medium">{activePipelineStepLabel}</span>
		</div>
	{/if}

	<!-- Company & Title -->
	<div class="mb-2 flex items-start justify-between gap-2">
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-1.5">
				<BuildingIcon class="size-3.5 shrink-0 text-primary-500" />
				<h3 class="truncate text-sm font-bold">{application.company}</h3>
			</div>
			<div class="mt-0.5 flex items-center gap-1.5">
				<BriefcaseIcon class="size-3 shrink-0 opacity-50" />
				<p class="truncate text-xs opacity-70">{application.title}</p>
			</div>
		</div>
		{#if application.job_description_url}
			<span class="shrink-0 opacity-40">
				<ExternalLinkIcon class="size-3.5" />
			</span>
		{/if}
	</div>

	<!-- Footer: date + badges -->
	<div class="flex items-center justify-between gap-2">
		<div class="flex items-center gap-1 text-xs opacity-50">
			<CalendarIcon class="size-3" />
			<span>{formattedDate}</span>
		</div>
		<div class="flex items-center gap-1">
			{#if missingFieldsCount > 0}
				<span class="badge preset-filled-warning-500 text-[10px]">
					{missingFieldsCount} missing
				</span>
			{/if}
			{#if application.fields && application.fields.length > 0}
				<span class="badge preset-outlined-surface-500 text-[10px]">
					{application.fields.filter((f) => f.status === 'filled').length}/{application.fields
						.length} fields
				</span>
			{/if}
		</div>
	</div>

	<!-- Apply button for backlog items -->
	{#if isBacklog}
		<div class="mt-2 border-t border-surface-200-800 pt-2">
			{#if isQueued}
				<!-- Queued state -->
				<div class="flex items-center justify-between gap-2">
					<div class="flex items-center gap-1.5 text-xs text-tertiary-500">
						<LoaderCircleIcon class="size-3.5 animate-spin" />
						<span>Queued — waiting…</span>
					</div>
					<button
						type="button"
						class="preset-ghost-surface btn btn-sm text-[10px]"
						onclick={handleCancelQueue}
					>
						Cancel
					</button>
				</div>
			{:else}
				<button
					type="button"
					class="btn w-full gap-1.5 preset-filled-primary-500 btn-sm"
					disabled={isApplying}
					onclick={handleApply}
				>
					{#if isApplying}
						<LoaderCircleIcon class="size-3.5 animate-spin" />
						<span>Starting…</span>
					{:else}
						<PlayIcon class="size-3.5" />
						<span>Apply</span>
					{/if}
				</button>
			{/if}
			{#if applyError}
				<p class="mt-1 text-[10px] text-error-500">{applyError}</p>
			{/if}
		</div>
	{/if}

	<!-- In-progress step indicator footer -->
	{#if isInProgress && hasActivePipeline && activePipelineRun?.current_step}
		<div class="mt-2 border-t border-surface-200-800 pt-2">
			<div class="flex items-center justify-between text-[10px] opacity-60">
				{#each ['research', 'resume', 'apply'] as step (step)}
					{@const isDone = activePipelineRun.steps_completed.includes(
						step as 'research' | 'resume' | 'apply'
					)}
					{@const isCurrent = activePipelineRun.current_step === step}
					<div class="flex items-center gap-1">
						{#if isDone}
							<span class="size-1.5 rounded-full bg-success-500"></span>
						{:else if isCurrent}
							<span class="size-1.5 animate-pulse rounded-full bg-tertiary-500"></span>
						{:else}
							<span class="size-1.5 rounded-full bg-surface-400-600"></span>
						{/if}
						<span class:opacity-100={isCurrent || isDone} class:opacity-40={!isCurrent && !isDone}>
							{step}
						</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</a>

<!-- Conflict dialog — rendered outside the <a> to avoid nesting issues -->
{#if conflict}
	<ApplyConflictDialog
		targetCompany={application.company}
		targetTitle={application.title}
		activeCompany={conflict.activeCompany}
		activeTitle={conflict.activeTitle}
		onQueue={handleConflictQueue}
		onCancelAndStart={handleConflictCancelAndStart}
		onClose={handleConflictClose}
	/>
{/if}
