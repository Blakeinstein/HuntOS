<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import {
		ScrollTextIcon,
		ChevronLeftIcon,
		ChevronRightIcon,
		InboxIcon,
		RadioIcon,
		LoaderCircleIcon
	} from '@lucide/svelte';
	import AuditFilters from '$lib/components/AuditFilters.svelte';
	import AuditLogRow from '$lib/components/AuditLogRow.svelte';
	import LiveScrapePanel from '$lib/components/LiveScrapePanel.svelte';
	import { activeScrapes, onScrapeFinish } from '$lib/stores/activeScrapes';
	import { onDestroy } from 'svelte';

	let { data } = $props();

	const logs = $derived(data.auditLogs ?? []);
	const total = $derived(data.total ?? 0);
	const limit = $derived(data.limit ?? 50);
	const offset = $derived(data.offset ?? 0);
	const jobBoards: Array<{ id: number; name: string; base_url: string }> = $derived(
		data.jobBoards ?? []
	);

	const currentPage = $derived(Math.floor(offset / limit) + 1);
	const totalPages = $derived(Math.max(1, Math.ceil(total / limit)));
	const hasPrev = $derived(offset > 0);
	const hasNext = $derived(offset + limit < total);

	let selectedBoardId = $state<number | null>(null);

	const selectedBoard = $derived(
		selectedBoardId != null
			? jobBoards.find(
					(b: { id: number; name: string; base_url: string }) => b.id === selectedBoardId
				)
			: null
	);

	// Derive active scrapes from the global store (includes scrapes started from job boards page)
	const activeEntries = $derived(
		Array.from(activeScrapes.entries()).filter(
			([, s]) => s.state === 'connecting' || s.state === 'streaming'
		)
	);

	const hasActiveScrapes = $derived(activeEntries.length > 0);

	// When a scrape started from elsewhere selects a board, auto-select it in the panel
	$effect(() => {
		if (hasActiveScrapes && selectedBoardId == null) {
			const [firstBoardId] = activeEntries[0];
			selectedBoardId = firstBoardId;
		}
	});

	// Listen for scrape finishes globally to auto-refresh the audit log list
	const unsubFinish = onScrapeFinish(() => {
		refreshLogs();
	});

	onDestroy(() => {
		unsubFinish();
	});

	function refreshLogs() {
		invalidate('audit:logs');
		setTimeout(() => {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- dynamic query string
			goto(`${resolve('/audit')}${$page.url.search}`, { invalidateAll: true });
		}, 500);
	}

	function goToPage(pageNum: number) {
		const params = new SvelteURLSearchParams($page.url.searchParams.toString());
		const newOffset = (pageNum - 1) * limit;

		if (newOffset > 0) {
			params.set('offset', String(newOffset));
		} else {
			params.delete('offset');
		}

		const qs = params.toString();
		const base = resolve('/audit');
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- dynamic query string
		goto(qs ? `${base}?${qs}` : base, { replaceState: true });
	}

	function handleScrapeFinish() {
		refreshLogs();
	}
</script>

<div class="mx-auto max-w-5xl space-y-4">
	<!-- Page header -->
	<div class="flex items-start justify-between gap-4">
		<div>
			<div class="flex items-center gap-2">
				<ScrollTextIcon class="size-6 text-primary-500" />
				<h1 class="h3 font-bold">Audit Log</h1>
			</div>
			<p class="mt-1 text-sm opacity-60">
				Execution history for scraping runs, browser actions, and other automated tasks.
			</p>
		</div>
		<div class="flex items-center gap-2">
			{#if hasActiveScrapes}
				<span class="badge flex items-center gap-1.5 preset-filled-primary-500 text-xs">
					<LoaderCircleIcon class="size-3 animate-spin" />
					{activeEntries.length} active
				</span>
			{/if}
			{#if total > 0}
				<span class="badge shrink-0 preset-filled-surface-500 text-xs">
					{total.toLocaleString()}
					{total === 1 ? 'entry' : 'entries'}
				</span>
			{/if}
		</div>
	</div>

	<!-- Active scrape banner: shows when scrapes are running (started from any page) -->
	{#if hasActiveScrapes}
		<div class="space-y-2">
			{#each activeEntries as [boardId, scrape] (boardId)}
				{@const board = jobBoards.find((b) => b.id === boardId)}
				<div
					class="flex items-center gap-3 rounded-lg border border-primary-500/30 bg-primary-500/5 px-4 py-2.5"
				>
					<LoaderCircleIcon class="size-4 shrink-0 animate-spin text-primary-500" />
					<div class="min-w-0 flex-1">
						<p class="text-xs font-medium">
							Scraping {scrape.boardName}{board ? ` — ${board.base_url}` : ''}
						</p>
						{#if scrape.events.length > 0}
							{@const latest = scrape.events.filter((e) => e.type !== 'text-delta').at(-1)}
							{#if latest}
								<p class="mt-0.5 truncate text-[11px] opacity-50">{latest.message}</p>
							{/if}
						{/if}
					</div>
					<span class="shrink-0 text-[10px] tabular-nums opacity-40">
						{scrape.events.length} events
					</span>
					<button
						type="button"
						class="btn gap-1 preset-tonal-primary btn-sm text-[10px]"
						onclick={() => (selectedBoardId = boardId)}
					>
						<RadioIcon class="size-3" />
						View Stream
					</button>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Live Scrape Panel -->
	{#if jobBoards.length > 0}
		<div class="card border border-surface-200-800 bg-surface-50-950 p-4">
			<div class="flex flex-col gap-3">
				<!-- Board picker -->
				<div class="flex items-center gap-3">
					<label for="board-picker" class="shrink-0 text-xs font-medium opacity-60">
						Job Board
					</label>
					<select
						id="board-picker"
						class="select flex-1 rounded-md border border-surface-200-800 bg-surface-50-950 px-3 py-1.5 text-xs"
						value={selectedBoardId ?? ''}
						onchange={(e) => {
							const val = (e.target as HTMLSelectElement).value;
							selectedBoardId = val ? Number(val) : null;
						}}
					>
						<option value="">Select a board to stream…</option>
						{#each jobBoards as board (board.id)}
							{@const isActive = activeEntries.some(([id]) => id === board.id)}
							<option value={board.id}>
								{board.name} — {board.base_url}{isActive ? ' (streaming)' : ''}
							</option>
						{/each}
					</select>
				</div>

				<!-- Live panel -->
				{#if selectedBoardId != null && selectedBoard}
					<LiveScrapePanel
						boardId={selectedBoardId}
						boardName={selectedBoard.name}
						onfinish={handleScrapeFinish}
					/>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Filters -->
	<div class="card border border-surface-200-800 bg-surface-50-950 p-4">
		<AuditFilters filters={data.filters} filterOptions={data.filterOptions} />
	</div>

	<!-- Log list -->
	{#if logs.length > 0}
		<div class="overflow-hidden card border border-surface-200-800 bg-surface-50-950">
			{#each logs as entry (entry.id)}
				<AuditLogRow {entry} />
			{/each}
		</div>

		<!-- Pagination -->
		{#if totalPages > 1}
			<div class="flex items-center justify-between">
				<p class="text-xs opacity-50">
					Showing {offset + 1}–{Math.min(offset + limit, total)} of {total.toLocaleString()}
				</p>

				<div class="flex items-center gap-1">
					<button
						type="button"
						class="btn preset-tonal btn-sm"
						disabled={!hasPrev}
						onclick={() => goToPage(currentPage - 1)}
						aria-label="Previous page"
					>
						<ChevronLeftIcon class="size-4" />
					</button>

					{#each Array.from({ length: totalPages }, (_, i) => i + 1) as pg (pg)}
						{#if totalPages <= 7 || pg === 1 || pg === totalPages || (pg >= currentPage - 1 && pg <= currentPage + 1)}
							<button
								type="button"
								class="btn min-w-9 btn-sm {pg === currentPage
									? 'preset-filled-primary-500'
									: 'preset-tonal'}"
								onclick={() => goToPage(pg)}
							>
								{pg}
							</button>
						{:else if pg === currentPage - 2 || pg === currentPage + 2}
							<span class="px-1 text-xs opacity-40">…</span>
						{/if}
					{/each}

					<button
						type="button"
						class="btn preset-tonal btn-sm"
						disabled={!hasNext}
						onclick={() => goToPage(currentPage + 1)}
						aria-label="Next page"
					>
						<ChevronRightIcon class="size-4" />
					</button>
				</div>
			</div>
		{/if}
	{:else}
		<!-- Empty state -->
		<div
			class="flex flex-col items-center justify-center gap-3 card border border-surface-200-800 bg-surface-50-950 px-6 py-16 text-center"
		>
			<div class="flex size-14 items-center justify-center rounded-full bg-surface-200-800/40">
				<InboxIcon class="size-7 opacity-40" />
			</div>
			<div>
				<h2 class="text-sm font-bold">No audit log entries</h2>
				<p class="mt-1 max-w-md text-xs opacity-60">
					{#if data.filters.category || data.filters.status || data.filters.agent_id || data.filters.search}
						No logs match the current filters. Try adjusting or clearing your filters.
					{:else}
						Execution logs will appear here once you run a scrape, browser action, or other
						automated task.
					{/if}
				</p>
			</div>
		</div>
	{/if}
</div>
