<script lang="ts">
	import { invalidate } from '$app/navigation';
	import {
		SearchIcon,
		LoaderCircleIcon,
		CheckCircleIcon,
		AlertCircleIcon,
		ShieldAlertIcon,
		ChevronDownIcon,
		ChevronUpIcon,
		XIcon,
		WrenchIcon,
		BotIcon,
		RadioIcon,
		XCircleIcon
	} from '@lucide/svelte';
	import { activeScrapes, dismissScrape, isScrapeActive } from '$lib/stores/activeScrapes';
	import { startScrapeStream, type ScrapeStreamController } from '$lib/services/scrapeStream';
	import type {
		AgentStepEvent,
		ScrapeFinishPayload
	} from '$lib/services/services/agentStream.types';

	interface Props {
		boardId: number;
		boardName?: string;
		disabled?: boolean;
	}

	let { boardId, boardName = 'Job Board', disabled = false }: Props = $props();

	let expanded = $state(false);
	let scrollContainer: HTMLDivElement | undefined = $state(undefined);
	let autoScroll = $state(true);
	let controller: ScrapeStreamController | null = null;

	// Reactive binding to the global active scrape for this board
	const scrape = $derived(activeScrapes.get(boardId) ?? null);
	const isActive = $derived(
		scrape != null && (scrape.state === 'connecting' || scrape.state === 'streaming')
	);
	const isDone = $derived(scrape != null && scrape.state === 'done');
	const isError = $derived(scrape != null && scrape.state === 'error');
	const isBlocked = $derived(scrape?.finishPayload?.blocked === true);
	const hasTerminal = $derived(isDone || isError);

	const events = $derived(scrape?.events ?? []);

	// Compact status line: show the latest non-text-delta event message
	const latestMessage = $derived.by(() => {
		if (!scrape || events.length === 0) return '';
		for (let i = events.length - 1; i >= 0; i--) {
			if (events[i].type !== 'text-delta') {
				return events[i].message;
			}
		}
		return events[0].message;
	});

	const stepCount = $derived(events.filter((e: AgentStepEvent) => e.type === 'step-finish').length);
	const toolCallCount = $derived(
		events.filter((e: AgentStepEvent) => e.type === 'tool-call').length
	);

	const elapsedMs = $derived.by(() => {
		if (events.length < 2) return 0;
		return events[events.length - 1].timestamp - events[0].timestamp;
	});

	const formattedElapsed = $derived.by(() => {
		if (elapsedMs < 1000) return `${elapsedMs}ms`;
		if (elapsedMs < 60_000) return `${(elapsedMs / 1000).toFixed(1)}s`;
		const mins = Math.floor(elapsedMs / 60_000);
		const secs = Math.round((elapsedMs % 60_000) / 1000);
		return `${mins}m ${secs}s`;
	});

	function scrollToBottom() {
		if (!autoScroll || !scrollContainer) return;
		requestAnimationFrame(() => {
			if (scrollContainer) {
				scrollContainer.scrollTop = scrollContainer.scrollHeight;
			}
		});
	}

	function handleScroll() {
		if (!scrollContainer) return;
		const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
		const atBottom = scrollHeight - scrollTop - clientHeight < 40;
		autoScroll = atBottom;
	}

	async function triggerScrape() {
		if (isScrapeActive(boardId)) return;

		expanded = true;
		autoScroll = true;

		controller = startScrapeStream({
			boardId,
			boardName,
			onEvent: () => {
				scrollToBottom();
			},
			onFinish: async (payload: ScrapeFinishPayload) => {
				if (payload.newApplications > 0) {
					await invalidate('db:job-boards');
				}
			},
			onError: () => {
				// error state is handled reactively
			}
		});
	}

	function stopScrape() {
		controller?.abort();
		controller = null;
	}

	function dismiss() {
		stopScrape();
		dismissScrape(boardId);
		expanded = false;
	}

	function eventIcon(type: string) {
		switch (type) {
			case 'scrape-start':
				return RadioIcon;
			case 'tool-call':
				return WrenchIcon;
			case 'tool-result':
				return CheckCircleIcon;
			case 'tool-error':
			case 'scrape-error':
				return XCircleIcon;
			case 'text-delta':
				return BotIcon;
			case 'step-start':
				return RadioIcon;
			case 'step-finish':
			case 'scrape-finish':
				return CheckCircleIcon;
			default:
				return RadioIcon;
		}
	}

	function eventColor(type: string): string {
		switch (type) {
			case 'tool-call':
				return 'text-primary-500';
			case 'tool-result':
				return 'text-success-500';
			case 'tool-error':
			case 'scrape-error':
				return 'text-error-500';
			case 'step-finish':
			case 'scrape-finish':
				return 'text-success-500';
			case 'text-delta':
				return 'text-tertiary-500';
			default:
				return 'opacity-50';
		}
	}

	function formatTimeDelta(event: AgentStepEvent): string {
		if (events.length === 0) return '';
		const delta = event.timestamp - events[0].timestamp;
		if (delta < 1000) return `+${delta}ms`;
		return `+${(delta / 1000).toFixed(1)}s`;
	}
</script>

<!-- Scrape trigger + inline streaming feed -->
<div class="mt-3 flex flex-col gap-2 border-t border-surface-200-800 pt-3">
	<!-- Header row: label + action buttons -->
	<div class="flex items-center justify-between">
		<span class="text-[10px] font-medium tracking-wide uppercase opacity-40">Manual Scrape</span>

		<div class="flex items-center gap-1.5">
			{#if isActive}
				<!-- Streaming: show stop button -->
				<button
					type="button"
					class="btn gap-1 preset-tonal-error btn-sm text-[10px]"
					onclick={stopScrape}
					title="Stop the running scrape"
				>
					<XIcon class="size-3" />
					<span>Stop</span>
				</button>
			{:else if hasTerminal}
				<!-- Done/Error: show dismiss + retry -->
				<button
					type="button"
					class="btn gap-1 preset-tonal btn-sm text-[10px]"
					onclick={dismiss}
					title="Dismiss results"
				>
					<XIcon class="size-3" />
					<span>Dismiss</span>
				</button>
				<button
					type="button"
					class="btn gap-1.5 preset-tonal-primary btn-sm text-[10px]"
					{disabled}
					onclick={triggerScrape}
					title="Run scrape again"
				>
					<SearchIcon class="size-3" />
					<span>Retry</span>
				</button>
			{:else}
				<!-- Idle: show scrape now -->
				<button
					type="button"
					class="btn gap-1.5 preset-tonal-primary btn-sm"
					{disabled}
					onclick={triggerScrape}
					title="Manually trigger a scrape of this job board"
				>
					<SearchIcon class="size-3.5" />
					<span>Scrape Now</span>
				</button>
			{/if}
		</div>
	</div>

	<!-- Compact status bar: appears as soon as streaming starts -->
	{#if scrape && events.length > 0}
		<button
			type="button"
			class="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-surface-200-800/30 {isActive
				? 'bg-primary-500/5'
				: isDone && !isBlocked
					? 'bg-success-500/5'
					: isBlocked
						? 'bg-warning-500/5'
						: isError
							? 'bg-error-500/5'
							: ''}"
			onclick={() => (expanded = !expanded)}
		>
			<!-- Spinner or status icon -->
			{#if isActive}
				<LoaderCircleIcon class="size-3.5 shrink-0 animate-spin text-primary-500" />
			{:else if isDone && !isBlocked}
				<CheckCircleIcon class="size-3.5 shrink-0 text-success-500" />
			{:else if isBlocked}
				<ShieldAlertIcon class="size-3.5 shrink-0 text-warning-500" />
			{:else if isError}
				<AlertCircleIcon class="size-3.5 shrink-0 text-error-500" />
			{/if}

			<!-- Latest message -->
			<span class="min-w-0 flex-1 truncate text-xs opacity-70">
				{latestMessage}
			</span>

			<!-- Stats -->
			{#if stepCount > 0 || toolCallCount > 0}
				<span class="shrink-0 text-[10px] tabular-nums opacity-40">
					{#if stepCount > 0}{stepCount}s{/if}
					{#if toolCallCount > 0}
						· {toolCallCount}t{/if}
					{#if elapsedMs > 0}
						· {formattedElapsed}{/if}
				</span>
			{/if}

			<!-- Expand/collapse chevron -->
			{#if expanded}
				<ChevronUpIcon class="size-3 shrink-0 opacity-40" />
			{:else}
				<ChevronDownIcon class="size-3 shrink-0 opacity-40" />
			{/if}
		</button>
	{/if}

	<!-- Expanded event log -->
	{#if expanded && events.length > 0}
		<div class="overflow-hidden rounded-lg border border-surface-200-800 bg-surface-50-950">
			<div class="max-h-52 overflow-y-auto" bind:this={scrollContainer} onscroll={handleScroll}>
				{#each events as event, i (i)}
					{#if event.type !== 'text-delta'}
						{@const Icon = eventIcon(event.type)}
						{@const color = eventColor(event.type)}

						<div
							class="flex items-start gap-2 border-b border-surface-200-800/50 px-2.5 py-1.5 last:border-b-0"
						>
							<Icon class="mt-0.5 size-3 shrink-0 {color}" />
							<span class="min-w-0 flex-1 text-[11px] leading-relaxed wrap-break-word opacity-70">
								{event.message}
							</span>
							<span class="shrink-0 pt-0.5 font-mono text-[9px] opacity-25">
								{formatTimeDelta(event)}
							</span>
						</div>
					{/if}
				{/each}

				{#if isActive}
					<div class="flex items-center gap-2 px-2.5 py-1.5 opacity-40">
						<LoaderCircleIcon class="size-3 animate-spin" />
						<span class="text-[10px]">Streaming…</span>
					</div>
				{/if}
			</div>

			<!-- Terminal summary bar -->
			{#if isDone && scrape?.finishPayload}
				{@const fp = scrape.finishPayload}
				<div
					class="flex items-center gap-2 border-t px-2.5 py-1.5 {fp.success && !fp.blocked
						? 'border-success-500/20 bg-success-500/5'
						: fp.blocked
							? 'border-warning-500/20 bg-warning-500/5'
							: 'border-error-500/20 bg-error-500/5'}"
				>
					{#if fp.success && !fp.blocked}
						<CheckCircleIcon class="size-3.5 text-success-500" />
						<span class="text-[11px] font-medium text-success-600 dark:text-success-400">
							Found {fp.totalFound} listing{fp.totalFound === 1 ? '' : 's'}
							&middot; {fp.newApplications} new &middot; {fp.duplicatesSkipped} duplicates
						</span>
					{:else if fp.blocked}
						<ShieldAlertIcon class="size-3.5 text-warning-500" />
						<span class="text-[11px] font-medium text-warning-600 dark:text-warning-400">
							Access blocked — log in via the remote Chrome session
						</span>
					{:else}
						<AlertCircleIcon class="size-3.5 text-warning-500" />
						<span class="text-[11px] font-medium text-warning-600 dark:text-warning-400">
							Completed with {fp.errors.length} issue{fp.errors.length === 1 ? '' : 's'}
						</span>
					{/if}
				</div>
			{/if}

			{#if isError && scrape?.errorPayload}
				<div
					class="flex items-center gap-2 border-t border-error-500/20 bg-error-500/5 px-2.5 py-1.5"
				>
					<XCircleIcon class="size-3.5 text-error-500" />
					<span class="text-[11px] font-medium text-error-600 dark:text-error-400">
						{scrape.errorPayload.error}
					</span>
				</div>
			{/if}
		</div>
	{/if}
</div>
