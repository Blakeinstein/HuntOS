<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { SearchIcon, FilterIcon, XIcon } from '@lucide/svelte';

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

	const hasActiveFilters = $derived(
		filters.category ||
			filters.status ||
			filters.agent_id ||
			filters.since ||
			filters.until ||
			filters.search
	);

	function buildUrl(key: string, value: string | null) {
		const params = new SvelteURLSearchParams($page.url.searchParams.toString());

		if (value) {
			params.set(key, value);
		} else {
			params.delete(key);
		}

		// Reset offset when filters change
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
	<!-- Search bar -->
	<div class="relative">
		<SearchIcon
			class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 opacity-40"
		/>
		<input
			type="text"
			placeholder="Search logs by title or detail..."
			class="input w-full rounded-lg border border-surface-200-800 bg-surface-50-950 py-2 pr-4 pl-10 text-sm"
			value={searchInput}
			oninput={handleSearchInput}
			onkeydown={handleSearchKeydown}
		/>
		{#if searchInput}
			<button
				type="button"
				class="absolute top-1/2 right-3 -translate-y-1/2 opacity-40 hover:opacity-70"
				onclick={() => {
					updateFilter('search', null);
				}}
				aria-label="Clear search"
			>
				<XIcon class="size-4" />
			</button>
		{/if}
	</div>

	<!-- Filter row -->
	<div class="flex flex-wrap items-center gap-2">
		<FilterIcon class="size-4 shrink-0 opacity-40" />

		<!-- Category filter -->
		<select
			class="select rounded-md border border-surface-200-800 bg-surface-50-950 px-3 py-1.5 text-xs"
			value={filters.category ?? ''}
			onchange={(e) => updateFilter('category', (e.target as HTMLSelectElement).value || null)}
		>
			<option value="">All Categories</option>
			{#each filterOptions.categories as cat (cat)}
				<option value={cat}>{categoryLabels[cat] ?? cat}</option>
			{/each}
		</select>

		<!-- Status filter -->
		<select
			class="select rounded-md border border-surface-200-800 bg-surface-50-950 px-3 py-1.5 text-xs"
			value={filters.status ?? ''}
			onchange={(e) => updateFilter('status', (e.target as HTMLSelectElement).value || null)}
		>
			<option value="">All Statuses</option>
			{#each filterOptions.statuses as s (s)}
				<option value={s}>{statusLabels[s] ?? s}</option>
			{/each}
		</select>

		<!-- Agent filter -->
		{#if filterOptions.agentIds.length > 0}
			<select
				class="select rounded-md border border-surface-200-800 bg-surface-50-950 px-3 py-1.5 text-xs"
				value={filters.agent_id ?? ''}
				onchange={(e) => updateFilter('agent_id', (e.target as HTMLSelectElement).value || null)}
			>
				<option value="">All Agents</option>
				{#each filterOptions.agentIds as agentId (agentId)}
					<option value={agentId}>{agentId}</option>
				{/each}
			</select>
		{/if}

		<!-- Clear filters -->
		{#if hasActiveFilters}
			<button
				type="button"
				class="btn flex items-center gap-1 preset-tonal btn-sm text-xs"
				onclick={clearAllFilters}
			>
				<XIcon class="size-3" />
				Clear Filters
			</button>
		{/if}
	</div>
</div>
