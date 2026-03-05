<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import {
		RadioIcon,
		LoaderCircleIcon,
		CheckCircleIcon,
		XCircleIcon,
		AlertTriangleIcon,
		WrenchIcon,
		BotIcon,
		ChevronDownIcon,
		ChevronRightIcon,
		XIcon,
		ArrowDownIcon
	} from '@lucide/svelte';
	import type {
		AgentStepEvent,
		ToolCallPayload,
		ToolResultPayload,
		ToolErrorPayload,
		ScrapeFinishPayload,
		ScrapeErrorPayload,
		StepFinishPayload
	} from '$lib/services/services/agentStream.types';
	import {
		activeScrapes,
		dismissScrape,
		isScrapeActive,
		type ScrapeStreamState
	} from '$lib/stores/activeScrapes';
	import { startScrapeStream, type ScrapeStreamController } from '$lib/services/scrapeStream';

	interface Props {
		/** Job board database ID to scrape. */
		boardId: number;
		/** Human-readable board name for the header. */
		boardName?: string;
		/** Called when the stream finishes (success or error). */
		onfinish?: (result: { success: boolean; totalFound: number; newApplications: number }) => void;
		/**
		 * When true, hides all start/stop/retry/dismiss controls.
		 * Use this when embedding the panel as a read-only live log viewer.
		 */
		readonly?: boolean;
	}

	let { boardId, boardName = 'Job Board', onfinish, readonly = false }: Props = $props();

	// Reactive binding to the global active scrape for this board
	const scrape = $derived(activeScrapes.get(boardId) ?? null);
	const streamState: ScrapeStreamState | 'idle' = $derived(scrape?.state ?? 'idle');
	const events: AgentStepEvent[] = $derived(scrape?.events ?? []);
	const finishPayload = $derived(scrape?.finishPayload ?? null);
	const errorPayload = $derived(scrape?.errorPayload ?? null);

	let expandedEvents = new SvelteSet<number>();
	let autoScroll = $state(true);
	let controller: ScrapeStreamController | null = null;

	let scrollContainer: HTMLDivElement | undefined = $state(undefined);

	const stepCount = $derived(events.filter((e: AgentStepEvent) => e.type === 'step-finish').length);
	const toolCallCount = $derived(
		events.filter((e: AgentStepEvent) => e.type === 'tool-call').length
	);
	const elapsedMs = $derived.by(() => {
		if (events.length === 0) return 0;
		const first = events[0].timestamp;
		const last = events[events.length - 1].timestamp;
		return last - first;
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

	function toggleEvent(index: number) {
		if (expandedEvents.has(index)) {
			expandedEvents.delete(index);
		} else {
			expandedEvents.add(index);
		}
	}

	async function startStream() {
		if (isScrapeActive(boardId)) return;

		expandedEvents.clear();
		autoScroll = true;

		controller = startScrapeStream({
			boardId,
			boardName,
			onEvent: () => {
				scrollToBottom();
			},
			onFinish: (payload: ScrapeFinishPayload) => {
				onfinish?.({
					success: payload.success,
					totalFound: payload.totalFound,
					newApplications: payload.newApplications
				});
			},
			onError: () => {
				onfinish?.({
					success: false,
					totalFound: 0,
					newApplications: 0
				});
			}
		});
	}

	function stopStream() {
		controller?.abort();
		controller = null;
	}

	function dismiss() {
		stopStream();
		dismissScrape(boardId);
		expandedEvents.clear();
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
				return XCircleIcon;
			case 'text-delta':
				return BotIcon;
			case 'step-start':
				return RadioIcon;
			case 'step-finish':
				return CheckCircleIcon;
			case 'scrape-finish':
				return CheckCircleIcon;
			case 'scrape-error':
				return XCircleIcon;
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

	function hasExpandableData(event: AgentStepEvent): boolean {
		if (!event.data) return false;
		const kind = (event.data as { kind?: string }).kind;
		return (
			kind === 'tool-call' ||
			kind === 'tool-result' ||
			kind === 'tool-error' ||
			kind === 'step-finish' ||
			kind === 'scrape-finish' ||
			kind === 'scrape-error'
		);
	}

	function formatTimeDelta(event: AgentStepEvent): string {
		if (events.length === 0) return '';
		const delta = event.timestamp - events[0].timestamp;
		if (delta < 1000) return `+${delta}ms`;
		return `+${(delta / 1000).toFixed(1)}s`;
	}
</script>

<div class="flex flex-col gap-3">
	<!-- Header with controls -->
	<div class="flex items-center justify-between">
		<span class="text-[10px] font-medium tracking-wide uppercase opacity-40">
			Live Stream — {boardName}
		</span>
		<div class="flex items-center gap-2">
			{#if streamState === 'streaming' || streamState === 'connecting'}
				<span class="flex items-center gap-1 text-xs text-primary-500">
					<LoaderCircleIcon class="size-3 animate-spin" />
					{streamState === 'connecting' ? 'Connecting…' : 'Streaming…'}
				</span>
				{#if !readonly}
					<button
						type="button"
						class="btn gap-1 preset-tonal-error btn-sm text-[10px]"
						onclick={stopStream}
						title="Stop stream"
					>
						<XIcon class="size-3" />
						Stop
					</button>
				{/if}
			{:else if !readonly && (streamState === 'done' || streamState === 'error')}
				<button type="button" class="btn gap-1 preset-tonal btn-sm text-[10px]" onclick={dismiss}>
					<XIcon class="size-3" />
					Dismiss
				</button>
				<button
					type="button"
					class="btn gap-1 preset-tonal-primary btn-sm text-[10px]"
					onclick={startStream}
				>
					<RadioIcon class="size-3" />
					Retry
				</button>
			{:else if !readonly && streamState === 'idle'}
				<button type="button" class="btn gap-1.5 preset-tonal-primary btn-sm" onclick={startStream}>
					<RadioIcon class="size-3.5" />
					<span>Start Stream</span>
				</button>
			{/if}
		</div>
	</div>

	<!-- Event feed -->
	{#if events.length > 0 || streamState === 'connecting'}
		<div class="overflow-hidden rounded-lg border border-surface-200-800 bg-surface-50-950">
			<!-- Stats bar -->
			<div
				class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-surface-200-800 px-3 py-1.5"
			>
				<span class="text-[10px] opacity-50">
					{events.length} event{events.length === 1 ? '' : 's'}
				</span>
				<span class="text-[10px] opacity-40">
					{events.filter((e) => e.type !== 'text-delta').length} steps
				</span>
				{#if stepCount > 0}
					<span class="text-[10px] opacity-40">
						{stepCount} agent step{stepCount === 1 ? '' : 's'}
					</span>
				{/if}
				{#if toolCallCount > 0}
					<span class="text-[10px] opacity-40">
						{toolCallCount} tool call{toolCallCount === 1 ? '' : 's'}
					</span>
				{/if}
				{#if elapsedMs > 0}
					<span class="text-[10px] opacity-40">
						{formattedElapsed} elapsed
					</span>
				{/if}
				<span class="flex-1"></span>
				{#if !autoScroll}
					<button
						type="button"
						class="btn gap-1 preset-tonal btn-sm text-[10px]"
						onclick={() => {
							autoScroll = true;
							scrollToBottom();
						}}
						title="Scroll to bottom"
					>
						<ArrowDownIcon class="size-3" />
						Follow
					</button>
				{/if}
			</div>

			<!-- Scrollable event list -->
			<div class="max-h-96 overflow-y-auto" bind:this={scrollContainer} onscroll={handleScroll}>
				{#if streamState === 'connecting' && events.length === 0}
					<div class="flex items-center justify-center gap-2 px-4 py-8 opacity-50">
						<LoaderCircleIcon class="size-4 animate-spin" />
						<span class="text-xs">Connecting to stream…</span>
					</div>
				{/if}

				{#each events as event, i (i)}
					{@const Icon = eventIcon(event.type)}
					{@const color = eventColor(event.type)}
					{@const expandable = hasExpandableData(event)}
					{@const isExpanded = expandedEvents.has(i)}

					<!-- Skip text-delta events in the list view -->
					{#if event.type !== 'text-delta'}
						<div class="border-b border-surface-200-800/50 last:border-b-0">
							<!-- Event row (clickable if expandable) -->
							<button
								type="button"
								class="flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors {expandable
									? 'cursor-pointer hover:bg-surface-200-800/20'
									: 'cursor-default'}"
								disabled={!expandable}
								onclick={() => {
									if (expandable) toggleEvent(i);
								}}
							>
								<!-- Expand chevron -->
								<span class="flex w-3 shrink-0 items-center pt-0.5">
									{#if expandable}
										{#if isExpanded}
											<ChevronDownIcon class="size-3 opacity-40" />
										{:else}
											<ChevronRightIcon class="size-3 opacity-40" />
										{/if}
									{/if}
								</span>

								<!-- Event icon -->
								<Icon class="mt-0.5 size-3.5 shrink-0 {color}" />

								<!-- Message -->
								<span class="min-w-0 flex-1 text-xs leading-relaxed wrap-break-word">
									{event.message}
								</span>

								<!-- Time delta -->
								<span class="shrink-0 pt-0.5 font-mono text-[10px] opacity-30">
									{formatTimeDelta(event)}
								</span>
							</button>

							<!-- Expanded detail panel -->
							{#if isExpanded && event.data}
								<div
									class="mr-3 mb-2 ml-13 space-y-2 rounded border border-surface-200-800/50 bg-surface-100-900 p-2.5"
								>
									{#if event.data.kind === 'tool-call'}
										{@const d = event.data as ToolCallPayload}
										{#if d.args && Object.keys(d.args).length > 0}
											<div class="space-y-1">
												<span class="text-[10px] font-semibold tracking-wide uppercase opacity-40"
													>Arguments</span
												>
												<pre
													class="overflow-x-auto text-[11px] wrap-break-word whitespace-pre-wrap opacity-70">{JSON.stringify(
														d.args,
														null,
														2
													)}</pre>
											</div>
										{/if}
									{:else if event.data.kind === 'tool-result'}
										{@const d = event.data as ToolResultPayload}
										<div class="space-y-1">
											<span class="text-[10px] font-semibold tracking-wide uppercase opacity-40"
												>Result</span
											>
											<pre
												class="overflow-x-auto text-[11px] wrap-break-word whitespace-pre-wrap opacity-70">{d.result ??
													'(empty)'}</pre>
											{#if d.isError}
												<span class="text-[10px] font-medium text-error-500"
													>Tool reported an error</span
												>
											{/if}
										</div>
									{:else if event.data.kind === 'tool-error'}
										{@const d = event.data as ToolErrorPayload}
										<div class="space-y-1">
											<span class="text-[10px] font-semibold tracking-wide uppercase opacity-40"
												>Error</span
											>
											<pre
												class="overflow-x-auto text-[11px] wrap-break-word whitespace-pre-wrap text-error-500">{d.error}</pre>
										</div>
									{:else if event.data.kind === 'step-finish'}
										{@const d = event.data as StepFinishPayload}
										<div class="flex flex-wrap gap-3 text-[10px] opacity-60">
											{#if d.finishReason}
												<span>
													<strong>Reason:</strong>
													{d.finishReason}
												</span>
											{/if}
											{#if d.toolCallCount != null}
												<span>
													<strong>Tool calls:</strong>
													{d.toolCallCount}
												</span>
											{/if}
											{#if d.usage}
												<span>
													<strong>Tokens:</strong>
													{d.usage.totalTokens ?? '?'}
												</span>
											{/if}
										</div>
									{:else if event.data.kind === 'scrape-finish'}
										{@const d = event.data as ScrapeFinishPayload}
										<div class="space-y-1.5">
											<div class="flex flex-wrap gap-3 text-[10px]">
												<span class="opacity-60">
													<strong>Total found:</strong>
													{d.totalFound}
												</span>
												<span class="opacity-60"
													><strong class="text-success-500">New:</strong>
													{d.newApplications}</span
												>
												<span class="opacity-60"
													><strong>Duplicates:</strong>
													{d.duplicatesSkipped}</span
												>
												<span class="opacity-60"
													><strong class={d.success ? 'text-success-500' : 'text-warning-500'}
														>Status:</strong
													>
													{d.success ? 'Success' : d.blocked ? 'Blocked' : 'Issues'}</span
												>
											</div>
											{#if d.errors.length > 0}
												<div>
													<span class="text-[10px] font-semibold tracking-wide uppercase opacity-40"
														>Errors ({d.errors.length})</span
													>
													{#each d.errors as err (err)}
														<p class="text-[11px] text-error-500">{err}</p>
													{/each}
												</div>
											{/if}
										</div>
									{:else if event.data.kind === 'scrape-error'}
										{@const d = event.data as ScrapeErrorPayload}
										<div class="space-y-1">
											<pre
												class="overflow-x-auto text-[11px] wrap-break-word whitespace-pre-wrap text-error-500">{d.error}</pre>
											<span class="text-[10px] opacity-40"
												>Duration: {d.durationMs
													? `${(d.durationMs / 1000).toFixed(1)}s`
													: 'unknown'}</span
											>
										</div>
									{/if}
								</div>
							{/if}
						</div>
					{/if}
				{/each}

				<!-- Streaming indicator at the bottom -->
				{#if streamState === 'streaming'}
					<div class="flex items-center gap-2 px-3 py-2 opacity-40">
						<LoaderCircleIcon class="size-3 animate-spin" />
						<span class="text-[10px]">Receiving events…</span>
					</div>
				{/if}
			</div>

			<!-- Terminal summary bar -->
			{#if streamState === 'done' && finishPayload}
				<div
					class="flex items-center gap-2 border-t px-3 py-2 {finishPayload.success &&
					!finishPayload.blocked
						? 'border-success-500/20 bg-success-500/5'
						: finishPayload.blocked
							? 'border-warning-500/20 bg-warning-500/5'
							: 'border-error-500/20 bg-error-500/5'}"
				>
					{#if finishPayload.success}
						<CheckCircleIcon class="size-3.5 text-success-500" />
						<span class="text-xs font-medium text-success-600 dark:text-success-400">
							Done — {finishPayload.totalFound} jobs found, {finishPayload.newApplications} new
						</span>
					{:else if finishPayload.blocked}
						<AlertTriangleIcon class="size-3.5 text-warning-500" />
						<span class="text-xs font-medium text-warning-600 dark:text-warning-400">
							Blocked — log in via the remote Chrome session and retry
						</span>
					{:else}
						<AlertTriangleIcon class="size-3.5 text-warning-500" />
						<span class="text-xs font-medium text-warning-600 dark:text-warning-400">
							Completed with {finishPayload.errors.length} issue{finishPayload.errors.length === 1
								? ''
								: 's'}
						</span>
					{/if}
				</div>
			{/if}

			{#if streamState === 'error' && errorPayload}
				<div class="flex items-center gap-2 border-t border-error-500/20 bg-error-500/5 px-3 py-2">
					<XCircleIcon class="size-3.5 text-error-500" />
					<span class="text-xs font-medium text-error-600 dark:text-error-400">
						{errorPayload.error}
					</span>
				</div>
			{/if}
		</div>
	{/if}
</div>
