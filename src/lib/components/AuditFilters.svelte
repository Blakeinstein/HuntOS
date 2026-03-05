<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { SearchIcon, XIcon } from '@lucide/svelte';

	interface Props {
		filters: {
			category: string | null;
			status: string | null;
			agent_id: string | null;
			since: string | null;
			until: string | null;
			search: string | null;
		};
		filterOptions: {
			categories: string[];
			agentIds: string[];
			statuses: string[];
		};
	}

	let { filters, filterOptions }: Props = $props();

	let debounceTimer: ReturnType<typeof setTimeout>;
	let searchInput = $derived(filters.search ?? '');

	const categoryLabels: Record<string, string> = {
		scrape: 'Scraping',
		browser: 'Browser',
		resume: 'Resume',
		agent: 'Agent',
		profile: 'Profile',
		application: 'Application'
	};

	const statusLabels: Record<string, string> = {
		info: 'Info',
		success: 'Success',
		warning: 'Warning',
		error: 'Error'
	};

	const statusColors: Record<string, string> = {
		info: 'preset-tonal-tertiary',
		success: 'preset-tonal-success',
		warning: 'preset-tonal-warning',
		error: 'preset-tonal-error'
	};

	const activeFilterCount = $derived(
		[
			filters.category,
			filters.status,
			filters.agent_id,
			filters.since,
			filters.until,
			filters.search
		].filter(Boolean).length
	);

	function buildUrl(key: string, value: string | null) {
		const params = new SvelteURLSearchParams($page.url.searchParams.toString());
		if (value) {
			params.set(key, value);
		} else {
			params.delete(key);
		}
		params.delete('offset');
		const base = resolve('/audit');
		const qs = params.toString();
		return qs ? `${base}?${qs}` : base;
	}

	function updateFilter(key: string, value: string | null) {
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- dynamic query string
		goto(buildUrl(key, value), { replaceState: true, keepFocus: true });
	}

	function clearAllFilters() {
		goto(resolve('/audit'), { replaceState: true });
	}

	function handleSearchInput(e: Event) {
		const value = (e.target as HTMLInputElement).value;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			updateFilter('search', value.trim() || null);
		}, 300);
	}

	function handleSearchKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			clearTimeout(debounceTimer);
			const value = (e.target as HTMLInputElement).value;
			updateFilter('search', value.trim() || null);
		}
	}
</script>

<div class="flex flex-col gap-3">
	<!-- Search -->
	<div class="relative">
		<SearchIcon
			class="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 opacity-40"
		/>
		<input
			type="text"
			placeholder="Search logs…"
			class="input w-full rounded-lg border border-surface-200-800 bg-transparent py-2 pr-9 pl-9 text-sm placeholder:opacity-40 focus:outline-none"
			value={searchInput}
			oninput={handleSearchInput}
			onkeydown={handleSearchKeydown}
		/>
		{#if searchInput}
			<button
				type="button"
				class="absolute top-1/2 right-3 -translate-y-1/2 opacity-40 transition-opacity hover:opacity-70"
				onclick={() => updateFilter('search', null)}
				aria-label="Clear search"
			>
				<XIcon class="size-3.5" />
			</button>
		{/if}
	</div>

	<!-- Filter pills row -->
	<div class="flex flex-wrap items-center gap-1.5">
		<!-- Category pills -->
		{#each filterOptions.categories as cat (cat)}
			<button
				type="button"
				class="btn rounded-full btn-sm px-3 py-1 text-xs transition-all {filters.category === cat
					? 'preset-filled-primary-500'
					: 'preset-tonal opacity-60 hover:opacity-100'}"
				onclick={() => updateFilter('category', filters.category === cat ? null : cat)}
			>
				{categoryLabels[cat] ?? cat}
			</button>
		{/each}

		<!-- Divider -->
		{#if filterOptions.categories.length > 0 && filterOptions.statuses.length > 0}
			<span class="h-4 w-px bg-surface-300-700 opacity-40"></span>
		{/if}

		<!-- Status pills -->
		{#each filterOptions.statuses as s (s)}
			<button
				type="button"
				class="btn rounded-full btn-sm px-3 py-1 text-xs transition-all {filters.status === s
					? (statusColors[s] ?? 'preset-tonal')
					: 'preset-tonal opacity-60 hover:opacity-100'}"
				onclick={() => updateFilter('status', filters.status === s ? null : s)}
			>
				{statusLabels[s] ?? s}
			</button>
		{/each}

		<!-- Agent filter (only shown when there are multiple agents) -->
		{#if filterOptions.agentIds.length > 1}
			<span class="h-4 w-px bg-surface-300-700 opacity-40"></span>
			<select
				class="select h-7 rounded-full border border-surface-200-800 bg-transparent px-3 py-0 text-xs opacity-70 focus:opacity-100 focus:outline-none"
				value={filters.agent_id ?? ''}
				onchange={(e) => updateFilter('agent_id', (e.target as HTMLSelectElement).value || null)}
			>
				<option value="">All Agents</option>
				{#each filterOptions.agentIds as agentId (agentId)}
					<option value={agentId}>{agentId}</option>
				{/each}
			</select>
		{/if}

		<!-- Clear all -->
		{#if activeFilterCount > 0}
			<span class="h-4 w-px bg-surface-300-700 opacity-40"></span>
			<button
				type="button"
				class="btn flex items-center gap-1 rounded-full preset-tonal-error btn-sm px-3 py-1 text-xs"
				onclick={clearAllFilters}
			>
				<XIcon class="size-3" />
				Clear {activeFilterCount > 1 ? `${activeFilterCount} filters` : 'filter'}
			</button>
		{/if}
	</div>
</div>
