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
		ChevronUpIcon
	} from '@lucide/svelte';
	import type { PipelineRun, ApplicationResource, PipelineStep } from '$lib/services/types';
	import { PIPELINE_STEPS, PIPELINE_STEP_LABELS } from '$lib/services/types';

	interface Props {
		applicationId: number;
		pipelineRuns: PipelineRun[];
		latestRun: PipelineRun | null;
		resources: ApplicationResource[];
		isBacklog: boolean;
		onApply?: () => void;
	}

	let { applicationId, pipelineRuns, latestRun, resources, isBacklog, onApply }: Props = $props();

	let isPolling = $state(false);
	let pollTimer = $state<ReturnType<typeof setInterval> | null>(null);
	let expandedResources = new SvelteSet<number>();
	let localLatestRun = $state<PipelineRun | null>(null);
	let localResources = $state<ApplicationResource[]>([]);

	// Use local state if we've been polling, otherwise use props
	const activeRun = $derived(localLatestRun ?? latestRun);
	const activeResources = $derived(localResources.length > 0 ? localResources : resources);

	const isRunning = $derived(activeRun?.status === 'running');
	const isCompleted = $derived(activeRun?.status === 'completed');
	const isFailed = $derived(activeRun?.status === 'failed');
	const hasRun = $derived(activeRun !== null);

	// Start polling when a run is active
	$effect(() => {
		if (isRunning && !isPolling) {
			startPolling();
		} else if (!isRunning && isPolling) {
			stopPolling();
		}

		return () => {
			stopPolling();
		};
	});

	function startPolling() {
		if (pollTimer) return;
		isPolling = true;
		pollTimer = setInterval(async () => {
			await pollStatus();
		}, 2000);
	}

	function stopPolling() {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
		isPolling = false;
	}

	async function pollStatus() {
		try {
			const response = await fetch(`/api/applications/${applicationId}/pipeline`);
			if (!response.ok) return;

			const data = await response.json();
			localLatestRun = data.pipelineRun;
			localResources = data.resources ?? [];

			if (data.pipelineRun && data.pipelineRun.status !== 'running') {
				stopPolling();
			}
		} catch {
			// Silently handle polling errors
		}
	}

	function getStepStatus(step: PipelineStep): 'completed' | 'active' | 'pending' | 'error' {
		if (!activeRun) return 'pending';

		if (activeRun.steps_completed.includes(step)) return 'completed';
		if (activeRun.current_step === step) {
			if (isFailed) return 'error';
			return 'active';
		}

		// If the run failed and this step hasn't been reached yet
		if (isFailed) {
			const stepIndex = PIPELINE_STEPS.indexOf(step);
			const currentStepIndex = activeRun.current_step
				? PIPELINE_STEPS.indexOf(activeRun.current_step)
				: -1;
			if (stepIndex > currentStepIndex) return 'pending';
		}

		return 'pending';
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
			default:
				return 'bg-surface-500/15 text-surface-500';
		}
	}

	function formatResourceType(type: string): string {
		return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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
					{/if}
				</div>
				{#if activeRun?.started_at}
					<span class="text-xs opacity-50">
						Started {new Date(activeRun.started_at).toLocaleString()}
					</span>
				{/if}
			</div>

			<!-- Steps -->
			<div class="space-y-3">
				{#each PIPELINE_STEPS as step, i (step)}
					{@const status = getStepStatus(step)}
					{@const isLast = i === PIPELINE_STEPS.length - 1}
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
											: 'bg-surface-200-800'}"
							>
								{#if status === 'completed'}
									<CheckCircleIcon class="size-4 text-success-500" />
								{:else if status === 'active'}
									<LoaderCircleIcon class="size-4 animate-spin text-primary-500" />
								{:else if status === 'error'}
									<XCircleIcon class="size-4 text-error-500" />
								{:else}
									<CircleIcon class="size-4 opacity-30" />
								{/if}
							</div>
							{#if !isLast}
								<div
									class="mt-1 h-6 w-px {status === 'completed'
										? 'bg-success-500/40'
										: 'bg-surface-300-700'}"
								></div>
							{/if}
						</div>

						<!-- Step content -->
						<div class="flex-1 pb-2">
							<p
								class="text-sm font-semibold {status === 'completed'
									? 'text-success-500'
									: status === 'active'
										? 'text-primary-500'
										: status === 'error'
											? 'text-error-500'
											: 'opacity-50'}"
							>
								{PIPELINE_STEP_LABELS[step]}
							</p>
							{#if status === 'active'}
								<p class="mt-0.5 text-xs opacity-60">In progress…</p>
							{:else if status === 'completed'}
								<p class="mt-0.5 text-xs opacity-50">Done</p>
							{:else if status === 'error'}
								<p class="mt-0.5 text-xs text-error-500">
									{activeRun?.error_message ?? 'An error occurred'}
								</p>
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

			<!-- Retry button for failed runs -->
			{#if isFailed && isBacklog}
				<div class="mt-4 flex justify-end">
					<button
						type="button"
						class="btn gap-2 preset-filled-warning-500 btn-sm"
						onclick={() => onApply?.()}
					>
						<RefreshCwIcon class="size-3.5" />
						<span>Retry</span>
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
					<button
						type="button"
						class="flex w-full items-center gap-3 p-3 text-left hover:bg-surface-100-900"
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
