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

	type StreamState = 'idle' | 'connecting' | 'streaming' | 'done' | 'error';

	interface Props {
		/** Job board database ID to scrape. */
		boardId: number;
		/** Human-readable board name for the header. */
		boardName?: string;
		/** Called when the stream finishes (success or error). */
		onfinish?: (result: { success: boolean; totalFound: number; newApplications: number }) => void;
	}

	let { boardId, boardName = 'Job Board', onfinish }: Props = $props();

	let streamState: StreamState = $state('idle');
	let events: AgentStepEvent[] = $state([]);
	let finishPayload: ScrapeFinishPayload | null = $state(null);
	let errorPayload: ScrapeErrorPayload | null = $state(null);
	let expandedEvents = new SvelteSet<number>();
	let autoScroll = $state(true);
	let abortController: AbortController | null = null;

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
		if (streamState === 'streaming' || streamState === 'connecting') return;

		streamState = 'connecting';
		events = [];
		finishPayload = null;
		errorPayload = null;
		expandedEvents.clear();
		autoScroll = true;

		abortController = new AbortController();

		try {
			const response = await fetch(`/api/job-boards/${boardId}/scrape-stream`, {
				method: 'POST',
				signal: abortController.signal
			});

			if (!response.ok) {
				const body = await response.text();
				let errorMsg: string;
				try {
					errorMsg = JSON.parse(body).error ?? body;
				} catch {
					errorMsg = body;
				}
				streamState = 'error';
				events = [
					...events,
					{
						type: 'scrape-error',
						timestamp: Date.now(),
						message: `HTTP ${response.status}: ${errorMsg}`
					}
				];
				return;
			}

			streamState = 'streaming';

			const reader = response.body?.getReader();
			if (!reader) {
				streamState = 'error';
				return;
			}

			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });

				// Parse SSE lines
				const lines = buffer.split('\n');
				// Keep the last incomplete line in the buffer
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					if (!line.startsWith('data: ')) continue;
					const json = line.slice(6).trim();
					if (!json) continue;

					try {
						const event: AgentStepEvent = JSON.parse(json);
						events = [...events, event];

						if (event.type === 'scrape-finish') {
							finishPayload = event.data as ScrapeFinishPayload;
							streamState = 'done';
							onfinish?.({
								success: finishPayload.success,
								totalFound: finishPayload.totalFound,
								newApplications: finishPayload.newApplications
							});
						} else if (event.type === 'scrape-error') {
							errorPayload = event.data as ScrapeErrorPayload;
							streamState = 'error';
							onfinish?.({
								success: false,
								totalFound: 0,
								newApplications: 0
							});
						}

						scrollToBottom();
					} catch {
						// Ignore malformed JSON
					}
				}
			}

			// If we finished reading but never got a terminal event
			if (streamState === 'streaming') {
				streamState = 'done';
			}
		} catch (err) {
			if (abortController?.signal.aborted) {
				streamState = 'idle';
				return;
			}
			streamState = 'error';
			const message = err instanceof Error ? err.message : String(err);
			events = [
				...events,
				{
					type: 'scrape-error',
					timestamp: Date.now(),
					message: `Connection error: ${message}`
				}
			];
		}
	}

	function stopStream() {
		abortController?.abort();
		abortController = null;
		if (streamState === 'streaming' || streamState === 'connecting') {
			streamState = 'idle';
		}
	}

	function dismiss() {
		stopStream();
		streamState = 'idle';
		events = [];
		finishPayload = null;
		errorPayload = null;
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
	<!-- Header row -->
	<div class="flex items-center justify-between">
		<span class="text-[10px] font-medium tracking-wide uppercase opacity-40">Live Scrape</span>
		<div class="flex items-center gap-2">
			{#if streamState === 'streaming' || streamState === 'connecting'}
				<span class="flex items-center gap-1 text-xs text-primary-500">
					<LoaderCircleIcon class="size-3 animate-spin" />
					{streamState === 'connecting' ? 'Connecting…' : 'Streaming'}
				</span>
				<button
					type="button"
					class="btn gap-1 preset-tonal-error btn-sm text-[10px]"
					onclick={stopStream}
				>
					<XIcon class="size-3" />
					Stop
				</button>
			{:else if streamState === 'done' || streamState === 'error'}
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
					Run Again
				</button>
			{:else}
				<button type="button" class="btn gap-1.5 preset-tonal-primary btn-sm" onclick={startStream}>
					<RadioIcon class="size-3.5" />
					<span>Stream Scrape</span>
				</button>
			{/if}
		</div>
	</div>

	<!-- Events panel -->
	{#if events.length > 0 || streamState === 'connecting'}
		<div class="overflow-hidden rounded-lg border border-surface-200-800 bg-surface-50-950">
			<!-- Stats bar -->
			<div
				class="flex items-center gap-4 border-b border-surface-200-800 bg-surface-100-900/50 px-3 py-1.5"
			>
				<span class="text-[10px] opacity-50">
					{boardName}
				</span>
				<span class="text-[10px] opacity-40">
					{events.length} events
				</span>
				{#if stepCount > 0}
					<span class="text-[10px] opacity-40">
						{stepCount} steps
					</span>
				{/if}
				{#if toolCallCount > 0}
					<span class="text-[10px] opacity-40">
						{toolCallCount} tool calls
					</span>
				{/if}
				{#if elapsedMs > 0}
					<span class="text-[10px] opacity-40">
						{formattedElapsed}
					</span>
				{/if}
				<span class="flex-1"></span>
				{#if !autoScroll}
					<button
						type="button"
						class="flex items-center gap-1 text-[10px] text-primary-500 hover:underline"
						onclick={() => {
							autoScroll = true;
							scrollToBottom();
						}}
					>
						<ArrowDownIcon class="size-3" />
						Auto-scroll
					</button>
				{/if}
			</div>

			<!-- Event list -->
			<div class="max-h-96 overflow-y-auto" bind:this={scrollContainer} onscroll={handleScroll}>
				{#if streamState === 'connecting' && events.length === 0}
					<div class="flex items-center justify-center gap-2 px-4 py-8 opacity-50">
						<LoaderCircleIcon class="size-4 animate-spin" />
						<span class="text-xs">Connecting to agent…</span>
					</div>
				{/if}

				{#each events as event, i (i)}
					{@const Icon = eventIcon(event.type)}
					{@const color = eventColor(event.type)}
					{@const expandable = hasExpandableData(event)}
					{@const isExpanded = expandedEvents.has(i)}

					<!-- Skip text-delta events in the list for cleaner view -->
					{#if event.type !== 'text-delta'}
						<div class="border-b border-surface-200-800/50 last:border-b-0">
							<button
								type="button"
								class="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-100-900/30"
								onclick={() => {
									if (expandable) toggleEvent(i);
								}}
								disabled={!expandable}
							>
								<!-- Expand indicator -->
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

							<!-- Expanded details -->
							{#if isExpanded && event.data}
								<div
									class="border-t border-surface-200-800/30 bg-surface-100-900/20 px-3 py-2 pl-11"
								>
									{#if event.data.kind === 'tool-call'}
										{@const d = event.data as ToolCallPayload}
										{#if d.args && Object.keys(d.args).length > 0}
											<div class="space-y-1">
												<span class="text-[10px] font-semibold tracking-wide uppercase opacity-40"
													>Arguments</span
												>
												<pre
													class="max-h-40 overflow-auto rounded bg-surface-200-800/30 p-2 font-mono text-[11px] opacity-70">{JSON.stringify(
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
												class="max-h-40 overflow-auto rounded bg-surface-200-800/30 p-2 font-mono text-[11px] wrap-break-word whitespace-pre-wrap opacity-70">{d.result ??
													'(empty)'}</pre>
											{#if d.isError}
												<span class="text-[10px] font-medium text-error-500"
													>⚠ Tool returned an error result</span
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
												class="max-h-40 overflow-auto rounded bg-error-500/5 p-2 font-mono text-[11px] text-error-500">{d.error}</pre>
										</div>
									{:else if event.data.kind === 'step-finish'}
										{@const d = event.data as StepFinishPayload}
										<div class="flex flex-wrap gap-3 text-[10px] opacity-60">
											{#if d.finishReason}
												<span>Reason: <strong>{d.finishReason}</strong></span>
											{/if}
											{#if d.toolCallCount != null}
												<span>Tool calls: <strong>{d.toolCallCount}</strong></span>
											{/if}
											{#if d.usage}
												<span>Tokens: <strong>{d.usage.totalTokens ?? '?'}</strong></span>
											{/if}
										</div>
									{:else if event.data.kind === 'scrape-finish'}
										{@const d = event.data as ScrapeFinishPayload}
										<div class="space-y-1.5">
											<div class="flex flex-wrap gap-3 text-[10px]">
												<span class="opacity-60">Found: <strong>{d.totalFound}</strong></span>
												<span class="opacity-60"
													>New: <strong class="text-success-500">{d.newApplications}</strong></span
												>
												<span class="opacity-60"
													>Duplicates: <strong>{d.duplicatesSkipped}</strong></span
												>
												<span class="opacity-60"
													>Duration: <strong
														>{d.durationMs < 1000
															? `${d.durationMs}ms`
															: `${(d.durationMs / 1000).toFixed(1)}s`}</strong
													></span
												>
											</div>
											{#if d.errors.length > 0}
												<div>
													<span
														class="text-[10px] font-semibold tracking-wide text-error-500 uppercase"
														>Errors</span
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
												class="rounded bg-error-500/5 p-2 font-mono text-[11px] wrap-break-word whitespace-pre-wrap text-error-500">{d.error}</pre>
											<span class="text-[10px] opacity-40"
												>After {d.durationMs < 1000
													? `${d.durationMs}ms`
													: `${(d.durationMs / 1000).toFixed(1)}s`}</span
											>
										</div>
									{/if}
								</div>
							{/if}
						</div>
					{/if}
				{/each}

				<!-- Streaming indicator at bottom -->
				{#if streamState === 'streaming'}
					<div class="flex items-center gap-2 px-3 py-2 opacity-40">
						<LoaderCircleIcon class="size-3 animate-spin" />
						<span class="text-[10px]">Waiting for next event…</span>
					</div>
				{/if}
			</div>

			<!-- Terminal status bar -->
			{#if streamState === 'done' && finishPayload}
				<div
					class="flex items-center gap-2 border-t px-3 py-2 {finishPayload.success
						? 'border-success-500/20 bg-success-500/5'
						: finishPayload.blocked
							? 'border-warning-500/20 bg-warning-500/5'
							: 'border-warning-500/20 bg-warning-500/5'}"
				>
					{#if finishPayload.success}
						<CheckCircleIcon class="size-3.5 text-success-500" />
						<span class="text-xs font-medium text-success-600 dark:text-success-400">
							{finishPayload.totalFound} jobs found — {finishPayload.newApplications} new added
						</span>
					{:else if finishPayload.blocked}
						<AlertTriangleIcon class="size-3.5 text-warning-500" />
						<span class="text-xs font-medium text-warning-600 dark:text-warning-400">
							Blocked — login required in remote Chrome
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
