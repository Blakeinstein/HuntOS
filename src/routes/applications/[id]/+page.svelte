<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Tabs } from '@skeletonlabs/skeleton-svelte';
	import {
		ArrowLeftIcon,
		BuildingIcon,
		BriefcaseIcon,
		ExternalLinkIcon,
		CalendarIcon,
		ClockIcon,
		FileTextIcon,
		HistoryIcon,
		AlertCircleIcon,
		CheckCircleIcon,
		CircleDotIcon,
		PencilIcon,
		TrashIcon,
		StickyNoteIcon,
		RocketIcon,
		PlayIcon,
		LoaderCircleIcon
	} from '@lucide/svelte';
	import ApplyProgressPanel from '$lib/components/ApplyProgressPanel.svelte';
	import type { PipelineRun, ApplicationResource, PipelineStepLog } from '$lib/services/types';

	let { data } = $props();

	const application = $derived(data.application);
	const history = $derived(data.history ?? []);
	const pipelineRuns = $derived(
		((data as Record<string, unknown>).pipelineRuns as Array<PipelineRun>) ?? []
	);
	const latestPipelineRun = $derived(
		((data as Record<string, unknown>).latestPipelineRun as PipelineRun | null) ?? null
	);
	const resources = $derived(
		((data as Record<string, unknown>).resources as Array<ApplicationResource>) ?? []
	);
	const stepLogs = $derived(
		((data as Record<string, unknown>).stepLogs as Array<PipelineStepLog>) ?? []
	);

	let activeTab = $state('details');
	let notes = $state('');
	let isDeleting = $state(false);
	let isStartingApply = $state(false);
	let applyError = $state<string | null>(null);

	const isBacklog = $derived(application?.swimlane_name?.toLowerCase() === 'backlog');
	const isActionRequired = $derived(
		application?.swimlane_name?.toLowerCase() === 'action required'
	);
	const canApply = $derived(isBacklog || isActionRequired);

	const formattedCreated = $derived(
		application
			? new Date(application.created_at).toLocaleDateString('en-US', {
					year: 'numeric',
					month: 'long',
					day: 'numeric'
				})
			: ''
	);

	const formattedUpdated = $derived(
		application
			? new Date(application.updated_at).toLocaleDateString('en-US', {
					year: 'numeric',
					month: 'long',
					day: 'numeric',
					hour: '2-digit',
					minute: '2-digit'
				})
			: ''
	);

	const filledFields = $derived(
		application?.fields?.filter((f: { status: string }) => f.status === 'filled') ?? []
	);

	const missingFields = $derived(
		application?.fields?.filter(
			(f: { status: string }) => f.status === 'missing' || f.status === 'user_input_required'
		) ?? []
	);

	function getFieldStatusIcon(status: string): typeof CheckCircleIcon {
		switch (status) {
			case 'filled':
				return CheckCircleIcon;
			case 'missing':
			case 'user_input_required':
				return AlertCircleIcon;
			default:
				return CircleDotIcon;
		}
	}

	function getFieldStatusColor(status: string): string {
		switch (status) {
			case 'filled':
				return 'text-success-500';
			case 'missing':
			case 'user_input_required':
				return 'text-warning-500';
			default:
				return 'text-surface-500';
		}
	}

	function getStatusBadgePreset(name: string): string {
		switch (name?.toLowerCase()) {
			case 'applied':
				return 'preset-filled-primary-500';
			case 'rejected':
				return 'preset-filled-error-500';
			case 'action required':
				return 'preset-filled-warning-500';
			case 'backlog':
				return 'preset-filled-surface-500';
			default:
				return 'preset-filled-secondary-500';
		}
	}

	async function handleDelete() {
		if (!application) return;
		isDeleting = true;
		await fetch(`/api/applications/${application.id}`, { method: 'DELETE' });
		await goto(resolve('/applications'));
	}

	async function handleApply(resumeFrom?: string) {
		if (!application || isStartingApply) return;

		isStartingApply = true;
		applyError = null;

		try {
			const body: Record<string, unknown> = {};
			if (resumeFrom) {
				body.resumeFrom = resumeFrom;
			}

			const response = await fetch(`/api/applications/${application.id}/apply`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});

			const result = await response.json();

			if (!response.ok) {
				applyError = result.error ?? 'Failed to start apply pipeline';
				return;
			}

			// Switch to the apply progress tab and let the panel poll for updates
			activeTab = 'apply';

			// Invalidate the page data so pipeline runs appear
			await invalidate(`db:application:${application.id}`);
		} catch (err) {
			applyError = err instanceof Error ? err.message : 'Failed to start apply pipeline';
		} finally {
			isStartingApply = false;
		}
	}
</script>

{#if application}
	<div class="mx-auto max-w-5xl space-y-6">
		<!-- Back button + header -->
		<div class="flex items-start justify-between gap-4">
			<div class="flex items-start gap-3">
				<a
					href={resolve('/applications')}
					class="mt-1 btn-icon btn-icon-sm preset-tonal"
					aria-label="Back to roadmap"
				>
					<ArrowLeftIcon class="size-4" />
				</a>
				<div>
					<div class="flex items-center gap-2">
						<BuildingIcon class="size-5 text-primary-500" />
						<h1 class="h3 font-bold">{application.company}</h1>
					</div>
					<div class="mt-0.5 flex items-center gap-2">
						<BriefcaseIcon class="size-4 opacity-50" />
						<p class="text-sm opacity-70">{application.title}</p>
					</div>
				</div>
			</div>
			<div class="flex items-center gap-2">
				<span class="badge {getStatusBadgePreset(application.swimlane_name)}">
					{application.swimlane_name}
				</span>
				{#if canApply}
					<button
						type="button"
						class="btn-icon preset-filled-primary-500"
						title={isStartingApply ? 'Starting…' : isActionRequired ? 'Retry' : 'Apply'}
						disabled={isStartingApply}
						onclick={() => handleApply()}
					>
						{#if isStartingApply}
							<LoaderCircleIcon class="size-4 animate-spin" />
						{:else}
							<PlayIcon class="size-4" />
						{/if}
					</button>
				{/if}
				<button
					type="button"
					class="btn-icon preset-filled-error-500"
					title="Delete application"
					disabled={isDeleting}
					onclick={handleDelete}
				>
					<TrashIcon class="size-4" />
				</button>
			</div>
		</div>

		<!-- Apply error banner -->
		{#if applyError}
			<div class="card border border-error-500/30 bg-error-500/10 p-3">
				<div class="flex items-center gap-2">
					<AlertCircleIcon class="size-4 text-error-500" />
					<p class="text-sm text-error-500">{applyError}</p>
				</div>
			</div>
		{/if}

		<!-- Summary row -->
		<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
			<div class="card border border-surface-200-800 bg-surface-50-950 p-3">
				<p class="text-xs font-medium uppercase opacity-50">Created</p>
				<div class="mt-1 flex items-center gap-1.5 text-sm font-semibold">
					<CalendarIcon class="size-3.5 opacity-50" />
					{formattedCreated}
				</div>
			</div>
			<div class="card border border-surface-200-800 bg-surface-50-950 p-3">
				<p class="text-xs font-medium uppercase opacity-50">Updated</p>
				<div class="mt-1 flex items-center gap-1.5 text-sm font-semibold">
					<ClockIcon class="size-3.5 opacity-50" />
					{formattedUpdated}
				</div>
			</div>
			<div class="card border border-surface-200-800 bg-surface-50-950 p-3">
				<p class="text-xs font-medium uppercase opacity-50">Fields Filled</p>
				<div class="mt-1 flex items-center gap-1.5 text-sm font-semibold">
					<CheckCircleIcon class="size-3.5 text-success-500" />
					{filledFields.length} / {application.fields?.length ?? 0}
				</div>
			</div>
			<div class="card border border-surface-200-800 bg-surface-50-950 p-3">
				<p class="text-xs font-medium uppercase opacity-50">Job Posting</p>
				<div class="mt-1 text-sm font-semibold">
					{#if application.job_description_url}
						<a
							href={application.job_description_url}
							target="_blank"
							rel="external noopener noreferrer"
							class="inline-flex items-center gap-1 text-primary-500 hover:underline"
						>
							<ExternalLinkIcon class="size-3.5" />
							View posting
						</a>
					{:else}
						<span class="opacity-40">N/A</span>
					{/if}
				</div>
			</div>
		</div>

		<!-- Tabbed content -->
		<Tabs value={activeTab} onValueChange={(details) => (activeTab = details.value ?? 'details')}>
			<Tabs.List>
				<Tabs.Trigger value="details">
					<FileTextIcon class="mr-1.5 size-4" />
					Details
				</Tabs.Trigger>
				<Tabs.Trigger value="apply">
					<RocketIcon class="mr-1.5 size-4" />
					Apply Progress
					{#if latestPipelineRun?.status === 'running'}
						<span class="ml-1.5 badge preset-filled-primary-500 text-[10px]">
							<LoaderCircleIcon class="mr-0.5 size-2.5 animate-spin" />
							Live
						</span>
					{:else if latestPipelineRun?.status === 'failed'}
						<span class="ml-1.5 badge preset-filled-error-500 text-[10px]">Failed</span>
					{:else if latestPipelineRun?.status === 'completed'}
						<span class="ml-1.5 badge preset-filled-success-500 text-[10px]">Done</span>
					{:else if latestPipelineRun?.status === 'cancelled'}
						<span class="ml-1.5 badge preset-filled-warning-500 text-[10px]">Cancelled</span>
					{/if}
				</Tabs.Trigger>
				<Tabs.Trigger value="fields">
					<PencilIcon class="mr-1.5 size-4" />
					Form Fields
					{#if missingFields.length > 0}
						<span class="ml-1.5 badge preset-filled-warning-500 text-[10px]">
							{missingFields.length}
						</span>
					{/if}
				</Tabs.Trigger>
				<Tabs.Trigger value="history">
					<HistoryIcon class="mr-1.5 size-4" />
					History
				</Tabs.Trigger>
				<Tabs.Trigger value="notes">
					<StickyNoteIcon class="mr-1.5 size-4" />
					Notes
				</Tabs.Trigger>
				<Tabs.Indicator />
			</Tabs.List>

			<!-- Details tab -->
			<Tabs.Content value="details">
				<div class="mt-4 space-y-4 card border border-surface-200-800 bg-surface-50-950 p-5">
					<h2 class="h5 font-bold">Application Details</h2>
					<dl class="grid gap-4 md:grid-cols-2">
						<div>
							<dt class="text-xs font-medium uppercase opacity-50">Company</dt>
							<dd class="mt-0.5 text-sm font-semibold">{application.company}</dd>
						</div>
						<div>
							<dt class="text-xs font-medium uppercase opacity-50">Job Title</dt>
							<dd class="mt-0.5 text-sm font-semibold">{application.title}</dd>
						</div>
						<div>
							<dt class="text-xs font-medium uppercase opacity-50">Status</dt>
							<dd class="mt-0.5">
								<span class="badge {getStatusBadgePreset(application.swimlane_name)} text-xs">
									{application.swimlane_name}
								</span>
							</dd>
						</div>
						<div>
							<dt class="text-xs font-medium uppercase opacity-50">Job Posting</dt>
							<dd class="mt-0.5 text-sm">
								{#if application.job_description_url}
									<a
										href={application.job_description_url}
										target="_blank"
										rel="external noopener noreferrer"
										class="inline-flex items-center gap-1 text-primary-500 hover:underline"
									>
										<ExternalLinkIcon class="size-3.5" />
										{application.job_description_url}
									</a>
								{:else}
									<span class="opacity-40">No URL provided</span>
								{/if}
							</dd>
						</div>
					</dl>

					{#if application.job_description}
						<hr class="hr" />
						<div>
							<h3 class="mb-2 text-xs font-medium uppercase opacity-50">Job Description</h3>
							<div
								class="prose prose-sm max-w-none rounded-md bg-surface-100-900 p-4 text-sm leading-relaxed dark:prose-invert"
							>
								{application.job_description}
							</div>
						</div>
					{/if}
				</div>
			</Tabs.Content>

			<!-- Apply Progress tab -->
			<Tabs.Content value="apply">
				<div class="mt-4">
					<ApplyProgressPanel
						applicationId={application.id}
						{pipelineRuns}
						latestRun={latestPipelineRun}
						{resources}
						isBacklog={canApply}
						initialStepLogs={stepLogs}
						onApply={() => handleApply()}
						onResumeFrom={(step) => handleApply(step)}
					/>
				</div>
			</Tabs.Content>

			<!-- Form Fields tab -->
			<Tabs.Content value="fields">
				<div class="mt-4 space-y-4">
					{#if missingFields.length > 0}
						<div class="card border border-warning-500/30 bg-warning-500/10 p-4">
							<div class="flex items-center gap-2">
								<AlertCircleIcon class="size-5 text-warning-500" />
								<p class="text-sm font-semibold">
									{missingFields.length} field{missingFields.length === 1 ? '' : 's'} require{missingFields.length ===
									1
										? 's'
										: ''} attention
								</p>
							</div>
							<p class="mt-1 text-xs opacity-70">
								These fields are missing information and may block submission.
							</p>
						</div>
					{/if}

					{#if application.fields && application.fields.length > 0}
						<div class="grid gap-3 md:grid-cols-2">
							{#each application.fields as field (field.id)}
								{@const StatusIcon = getFieldStatusIcon(field.status)}
								<div
									class="flex items-start gap-3 card border border-surface-200-800 bg-surface-50-950 p-4"
								>
									<StatusIcon class="mt-0.5 size-4 shrink-0 {getFieldStatusColor(field.status)}" />
									<div class="min-w-0 flex-1">
										<p class="text-sm font-semibold">{field.field_name}</p>
										{#if field.field_value}
											<p class="mt-0.5 truncate text-xs opacity-70">{field.field_value}</p>
										{:else}
											<p class="mt-0.5 text-xs italic opacity-40">No value</p>
										{/if}
										<span
											class="mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium capitalize {field.status ===
											'filled'
												? 'bg-success-500/15 text-success-500'
												: field.status === 'missing' || field.status === 'user_input_required'
													? 'bg-warning-500/15 text-warning-500'
													: 'bg-surface-500/15 text-surface-500'}"
										>
											{field.status.replace(/_/g, ' ')}
										</span>
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<div
							class="flex items-center justify-center card border border-surface-200-800 bg-surface-50-950 p-10"
						>
							<div class="text-center">
								<FileTextIcon class="mx-auto size-8 opacity-30" />
								<p class="mt-2 text-sm opacity-50">No form fields recorded yet.</p>
								{#if isBacklog}
									<p class="mt-1 text-xs opacity-40">
										Form fields will be discovered when the apply pipeline runs.
									</p>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			</Tabs.Content>

			<!-- History tab -->
			<Tabs.Content value="history">
				<div class="mt-4">
					{#if history.length > 0}
						<div class="relative space-y-0 pl-6">
							<!-- Timeline line -->
							<div class="absolute top-0 bottom-0 left-2.75 w-px bg-surface-300-700"></div>

							{#each history as entry, i (entry.id)}
								<div class="relative flex items-start gap-4 pb-6">
									<!-- Timeline dot -->
									<div
										class="absolute -left-3.25 mt-1.5 size-3 rounded-full border-2 border-surface-50-950 {i ===
										history.length - 1
											? 'bg-primary-500'
											: 'bg-surface-400-600'}"
									></div>

									<!-- Entry content -->
									<div
										class="min-w-0 flex-1 card border border-surface-200-800 bg-surface-50-950 p-3"
									>
										<div class="flex items-center justify-between gap-2">
											<span class="badge {getStatusBadgePreset(entry.swimlane_name ?? '')} text-xs">
												{entry.swimlane_name ?? 'Unknown'}
											</span>
											<span class="text-xs opacity-50">
												{new Date(entry.created_at).toLocaleDateString('en-US', {
													month: 'short',
													day: 'numeric',
													hour: '2-digit',
													minute: '2-digit'
												})}
											</span>
										</div>
										{#if entry.reason}
											<p class="mt-1.5 text-xs opacity-60">{entry.reason}</p>
										{/if}
										<p class="mt-1 text-[10px] uppercase opacity-30">
											Changed by: {entry.changed_by}
										</p>
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<div
							class="flex items-center justify-center card border border-surface-200-800 bg-surface-50-950 p-10"
						>
							<div class="text-center">
								<HistoryIcon class="mx-auto size-8 opacity-30" />
								<p class="mt-2 text-sm opacity-50">No history yet.</p>
							</div>
						</div>
					{/if}
				</div>
			</Tabs.Content>

			<!-- Notes tab -->
			<Tabs.Content value="notes">
				<div class="mt-4 card border border-surface-200-800 bg-surface-50-950 p-5">
					<h2 class="mb-3 flex items-center gap-2 text-sm font-bold">
						<StickyNoteIcon class="size-4 opacity-50" />
						Notes
					</h2>
					<textarea
						class="textarea w-full"
						rows="8"
						placeholder="Add your notes about this application..."
						bind:value={notes}
					></textarea>
					<p class="mt-2 text-xs opacity-40">Notes are stored locally and are not synced.</p>
				</div>
			</Tabs.Content>
		</Tabs>
	</div>
{:else}
	<div class="flex h-full items-center justify-center">
		<div class="text-center">
			<AlertCircleIcon class="mx-auto size-12 opacity-30" />
			<p class="mt-3 text-lg opacity-50">Application not found</p>
			<a href={resolve('/applications')} class="mt-4 btn preset-tonal">Back to Roadmap</a>
		</div>
	</div>
{/if}
