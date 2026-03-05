<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Switch } from '@skeletonlabs/skeleton-svelte';
	import {
		GlobeIcon,
		PlusIcon,
		TrashIcon,
		ArrowLeftIcon,
		ClockIcon,
		LinkIcon,
		CheckCircleIcon,
		PlayIcon,
		PauseIcon,
		CalendarIcon,
		RefreshCwIcon,
		SearchIcon,
		ListIcon,
		DatabaseIcon,
		BookmarkIcon,
		PowerIcon,
		InfoIcon
	} from '@lucide/svelte';
	import ScrapeButton from '$lib/components/ScrapeButton.svelte';

	let { data } = $props();
	const jobBoards = $derived(data.jobBoards ?? []);
	let scraperEnabled = $derived(data.scraperEnabled ?? true);
	let togglingMaster = $state(false);

	async function toggleMasterScraper(enabled: boolean) {
		togglingMaster = true;
		try {
			await fetch('/api/settings/automation', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ scraperEnabled: enabled })
			});
			await invalidate('app:scraper-enabled');
		} finally {
			togglingMaster = false;
		}
	}

	let formState = $state({
		name: '',
		baseUrl: '',
		checkIntervalMinutes: '1440',
		maxListingsPerScrape: '25',
		pageRetentionDays: '3'
	});

	let isAdding = $state(false);
	let showForm = $state(false);
	let deleteConfirmId = $state<number | null>(null);

	async function addJobBoard() {
		isAdding = true;
		try {
			await fetch('/api/job-boards', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					name: formState.name,
					baseUrl: formState.baseUrl,
					checkIntervalMinutes: Number(formState.checkIntervalMinutes),
					maxListingsPerScrape: Number(formState.maxListingsPerScrape),
					pageRetentionDays: Number(formState.pageRetentionDays)
				})
			});

			formState = {
				name: '',
				baseUrl: '',
				checkIntervalMinutes: '1440',
				maxListingsPerScrape: '25',
				pageRetentionDays: '3'
			};
			showForm = false;
			await invalidate('db:job-boards');
		} finally {
			isAdding = false;
		}
	}

	async function deleteJobBoard(id: number) {
		await fetch(`/api/job-boards/${id}`, { method: 'DELETE' });
		deleteConfirmId = null;
		await invalidate('db:job-boards');
	}

	async function toggleJobBoard(id: number, currentEnabled: boolean) {
		await fetch(`/api/job-boards/${id}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ is_enabled: !currentEnabled })
		});
		await invalidate('db:job-boards');
	}

	function formatIntervalLabel(minutes: number): string {
		if (minutes < 60) return `Every ${minutes} minute${minutes === 1 ? '' : 's'}`;
		if (minutes < 1440) {
			const hours = Math.round(minutes / 60);
			return `Every ${hours} hour${hours === 1 ? '' : 's'}`;
		}
		const days = Math.round(minutes / 1440);
		return `Every ${days} day${days === 1 ? '' : 's'}`;
	}

	function formatLastChecked(dateStr: string | undefined | null): string {
		if (!dateStr) return 'Never';
		const date = new Date(dateStr);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);

		if (diffMins < 1) return 'Just now';
		if (diffMins < 60) return `${diffMins}m ago`;
		const diffHours = Math.floor(diffMins / 60);
		if (diffHours < 24) return `${diffHours}h ago`;
		const diffDays = Math.floor(diffHours / 24);
		return `${diffDays}d ago`;
	}

	const intervalOptions = [
		{ value: '30', label: 'Every 30 minutes' },
		{ value: '60', label: 'Every hour' },
		{ value: '180', label: 'Every 3 hours' },
		{ value: '360', label: 'Every 6 hours' },
		{ value: '720', label: 'Every 12 hours' },
		{ value: '1440', label: 'Every day' },
		{ value: '10080', label: 'Every week' }
	];

	const maxListingsOptions = [
		{ value: '10', label: '10 listings' },
		{ value: '25', label: '25 listings' },
		{ value: '50', label: '50 listings' },
		{ value: '75', label: '75 listings' },
		{ value: '100', label: '100 listings' }
	];

	const retentionOptions = [
		{ value: '1', label: '1 day' },
		{ value: '2', label: '2 days' },
		{ value: '3', label: '3 days' },
		{ value: '5', label: '5 days' },
		{ value: '7', label: '7 days' },
		{ value: '14', label: '14 days' }
	];

	function formatRetentionLabel(days: number): string {
		if (days === 1) return '1 day retention';
		return `${days} day retention`;
	}
</script>

<div class="mx-auto max-w-3xl space-y-6">
	<!-- Page header -->
	<div class="flex items-start justify-between gap-4">
		<div class="flex items-start gap-3">
			<a
				href={resolve('/settings')}
				class="mt-1 btn-icon btn-icon-sm preset-tonal"
				aria-label="Back to settings"
			>
				<ArrowLeftIcon class="size-4" />
			</a>
			<div>
				<h1 class="h3 font-bold">Job Boards</h1>
				<p class="text-sm opacity-60">
					Configure automated job board searches to discover new opportunities.
				</p>
			</div>
		</div>
		<button
			type="button"
			class="btn gap-2 preset-filled-primary-500"
			onclick={() => (showForm = !showForm)}
		>
			<PlusIcon class="size-4" />
			<span>Add Board</span>
		</button>
	</div>

	<!-- Master scraper toggle -->
	<div class="card border border-surface-200-800 bg-surface-50-950 p-4">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<div
					class="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary-500/10"
				>
					<PowerIcon class="size-4 text-secondary-500" />
				</div>
				<div>
					<p class="text-sm font-bold">Automated Scraping</p>
					<p class="text-xs opacity-50">
						{scraperEnabled
							? 'Boards are scraped on their configured intervals'
							: 'All automated scraping is paused'}
					</p>
				</div>
			</div>
			<Switch
				checked={scraperEnabled}
				disabled={togglingMaster}
				onCheckedChange={(e) => toggleMasterScraper(e.checked)}
			>
				<Switch.Control>
					<Switch.Thumb />
				</Switch.Control>
				<Switch.HiddenInput />
			</Switch>
		</div>
		{#if !scraperEnabled}
			<div
				class="mt-3 flex items-start gap-2 rounded-lg border border-warning-500/20 bg-warning-500/5 p-3"
			>
				<InfoIcon class="mt-0.5 size-4 shrink-0 text-warning-500" />
				<p class="text-xs text-warning-700 dark:text-warning-400">
					Automated scraping is disabled. Individual boards will not be checked until this is turned
					back on.
				</p>
			</div>
		{/if}
	</div>

	<!-- Info notice -->
	<div class="flex items-start gap-3 card border border-surface-200-800 bg-surface-50-950 p-4">
		<SearchIcon class="mt-0.5 size-4 shrink-0 opacity-40" />
		<div>
			<p class="text-xs opacity-60">
				Job boards are periodically scraped for new postings using browser automation. New postings
				are automatically added to the <strong>Backlog</strong> swimlane. Each board's
				<strong>Check Interval</strong> determines how often it is scraped.
			</p>
		</div>
	</div>

	<!-- Configured boards list -->
	<div class="card border border-surface-200-800 bg-surface-50-950 p-5">
		<h2 class="mb-4 flex items-center gap-2 text-sm font-bold">
			<GlobeIcon class="size-4 text-secondary-500" />
			Configured Boards
			<span class="badge preset-outlined-surface-500 text-xs">{jobBoards.length}</span>
		</h2>

		{#if jobBoards.length > 0}
			<div class="space-y-3">
				{#each jobBoards as board (board.id)}
					<div
						class="rounded-lg border border-surface-200-800 bg-surface-100-900 p-4 transition-all hover:border-surface-300-700"
						class:opacity-50={!board.is_enabled}
					>
						<!-- Main content row -->
						<div class="flex items-start justify-between gap-4">
							<div class="min-w-0 flex-1">
								<!-- Board name + status -->
								<div class="flex items-center gap-2">
									<h3 class="text-sm font-bold">{board.name}</h3>
									{#if board.is_enabled}
										<span
											class="inline-flex items-center gap-1 rounded-full bg-success-500/15 px-2 py-0.5 text-[10px] font-medium text-success-500"
										>
											<PlayIcon class="size-2.5" />
											Active
										</span>
									{:else}
										<span
											class="inline-flex items-center gap-1 rounded-full bg-surface-500/15 px-2 py-0.5 text-[10px] font-medium text-surface-500"
										>
											<PauseIcon class="size-2.5" />
											Paused
										</span>
									{/if}
								</div>

								<!-- URL -->
								<div class="mt-1 flex items-center gap-1.5">
									<LinkIcon class="size-3 shrink-0 opacity-40" />
									<a
										href={board.base_url}
										target="_blank"
										rel="external noopener noreferrer"
										class="truncate text-xs text-primary-500 hover:underline"
									>
										{board.base_url}
									</a>
								</div>

								<!-- Meta info row -->
								<div class="mt-2 flex flex-wrap items-center gap-3 text-xs opacity-50">
									<span class="inline-flex items-center gap-1">
										<ClockIcon class="size-3" />
										{formatIntervalLabel(board.check_interval_minutes)}
									</span>
									<span class="inline-flex items-center gap-1">
										<ListIcon class="size-3" />
										Max {board.max_listings_per_scrape} per scrape
									</span>
									<span class="inline-flex items-center gap-1">
										<DatabaseIcon class="size-3" />
										{formatRetentionLabel(board.page_retention_days)}
									</span>
									<span class="inline-flex items-center gap-1">
										<CalendarIcon class="size-3" />
										Last checked: {formatLastChecked(board.last_checked)}
									</span>
									{#if board.last_scraped_page}
										<span class="inline-flex items-center gap-1">
											<BookmarkIcon class="size-3" />
											Resumes at page {board.last_scraped_page}
										</span>
									{/if}
									{#if board.next_check}
										<span class="inline-flex items-center gap-1">
											<RefreshCwIcon class="size-3" />
											Next: {formatLastChecked(board.next_check)}
										</span>
									{/if}
								</div>
							</div>

							<!-- Actions -->
							<div class="flex shrink-0 items-center gap-2">
								<Switch
									checked={board.is_enabled}
									onCheckedChange={() => toggleJobBoard(board.id, board.is_enabled)}
								>
									<Switch.Control>
										<Switch.Thumb />
									</Switch.Control>
									<Switch.HiddenInput />
								</Switch>

								{#if deleteConfirmId === board.id}
									<div class="flex items-center gap-1">
										<button
											type="button"
											class="btn preset-filled-error-500 btn-sm text-xs"
											onclick={() => deleteJobBoard(board.id)}
										>
											Delete
										</button>
										<button
											type="button"
											class="btn preset-tonal btn-sm text-xs"
											onclick={() => (deleteConfirmId = null)}
										>
											No
										</button>
									</div>
								{:else}
									<button
										type="button"
										class="btn-icon btn-icon-sm hover:preset-tonal-error"
										title="Remove board"
										onclick={() => (deleteConfirmId = board.id)}
									>
										<TrashIcon class="size-4" />
									</button>
								{/if}
							</div>
						</div>

						<!-- Scrape button — full width below the main row -->
						<ScrapeButton boardId={board.id} boardName={board.name} disabled={!board.is_enabled} />
					</div>
				{/each}
			</div>
		{:else}
			<div
				class="flex flex-col items-center justify-center rounded-lg border border-dashed border-surface-300-700 p-10"
			>
				<GlobeIcon class="size-10 opacity-20" />
				<p class="mt-3 text-sm opacity-50">No job boards configured yet.</p>
				<p class="mt-1 text-xs opacity-30">
					Add a job board to start discovering new opportunities automatically.
				</p>
			</div>
		{/if}
	</div>

	<!-- Add job board form -->
	{#if showForm}
		<div class="card border border-primary-500/30 bg-surface-50-950 p-5">
			<h2 class="mb-4 flex items-center gap-2 text-sm font-bold">
				<PlusIcon class="size-4 text-primary-500" />
				Add Job Board
			</h2>

			<form
				onsubmit={(e) => {
					e.preventDefault();
					addJobBoard();
				}}
				class="space-y-5"
			>
				<!-- Name + URL -->
				<div class="grid gap-4 md:grid-cols-2">
					<label class="label">
						<span class="flex items-center gap-1.5 text-sm font-medium">
							<GlobeIcon class="size-3.5 opacity-50" />
							Board Name
						</span>
						<input
							type="text"
							class="mt-1 input"
							placeholder="LinkedIn - Remote Svelte Jobs"
							bind:value={formState.name}
							required
						/>
						<p class="mt-0.5 text-xs opacity-40">A friendly label for this search.</p>
					</label>

					<label class="label">
						<span class="flex items-center gap-1.5 text-sm font-medium">
							<LinkIcon class="size-3.5 opacity-50" />
							Search URL
						</span>
						<input
							type="url"
							class="mt-1 input"
							placeholder="https://linkedin.com/jobs/search?keywords=..."
							bind:value={formState.baseUrl}
							required
						/>
						<p class="mt-0.5 text-xs opacity-40">The full URL of the job search results page.</p>
					</label>
				</div>

				<!-- Check interval + Max listings + Retention -->
				<div class="grid gap-4 md:grid-cols-3">
					<label class="label">
						<span class="flex items-center gap-1.5 text-sm font-medium">
							<ClockIcon class="size-3.5 opacity-50" />
							Check Interval
						</span>
						<select class="select mt-1" bind:value={formState.checkIntervalMinutes}>
							{#each intervalOptions as opt (opt.value)}
								<option value={opt.value}>{opt.label}</option>
							{/each}
						</select>
						<p class="mt-0.5 text-xs opacity-40">How often to scan this board.</p>
					</label>

					<label class="label">
						<span class="flex items-center gap-1.5 text-sm font-medium">
							<ListIcon class="size-3.5 opacity-50" />
							Max Listings per Scrape
						</span>
						<select class="select mt-1" bind:value={formState.maxListingsPerScrape}>
							{#each maxListingsOptions as opt (opt.value)}
								<option value={opt.value}>{opt.label}</option>
							{/each}
						</select>
						<p class="mt-0.5 text-xs opacity-40">Cap on jobs collected per session.</p>
					</label>

					<label class="label">
						<span class="flex items-center gap-1.5 text-sm font-medium">
							<DatabaseIcon class="size-3.5 opacity-50" />
							Page Retention
						</span>
						<select class="select mt-1" bind:value={formState.pageRetentionDays}>
							{#each retentionOptions as opt (opt.value)}
								<option value={opt.value}>{opt.label}</option>
							{/each}
						</select>
						<p class="mt-0.5 text-xs opacity-40">Resume from last page within this window.</p>
					</label>
				</div>

				<!-- Actions -->
				<div class="flex justify-end gap-2 border-t border-surface-200-800 pt-4">
					<button type="button" class="btn preset-tonal" onclick={() => (showForm = false)}>
						Cancel
					</button>
					<button type="submit" class="btn gap-1.5 preset-filled-primary-500" disabled={isAdding}>
						{#if isAdding}
							<span class="animate-spin">⏳</span>
							<span>Saving...</span>
						{:else}
							<CheckCircleIcon class="size-4" />
							<span>Add Board</span>
						{/if}
					</button>
				</div>
			</form>
		</div>
	{/if}
</div>
