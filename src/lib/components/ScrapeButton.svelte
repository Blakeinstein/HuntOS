<script lang="ts">
	import { invalidate } from '$app/navigation';
	import {
		SearchIcon,
		LoaderCircleIcon,
		CheckCircleIcon,
		AlertCircleIcon,
		ShieldAlertIcon
	} from '@lucide/svelte';

	interface ScrapeResultData {
		success: boolean;
		newApplications: number;
		duplicatesSkipped: number;
		scrapeResult: {
			success: boolean;
			source_url: string;
			scraped_at: string;
			total_found: number;
			jobs: Array<{
				title: string;
				company: string;
				location?: string;
				url: string;
				salary_range?: string;
				posted_at?: string;
				relevance: 'high' | 'medium' | 'low';
			}>;
			errors: string[];
			blocked: boolean;
		} | null;
		errors: string[];
	}

	type ScrapeState = 'idle' | 'scraping' | 'success' | 'error' | 'blocked';

	interface Props {
		boardId: number;
		disabled?: boolean;
	}

	let { boardId, disabled = false }: Props = $props();

	let scrapeState = $state<ScrapeState>('idle');
	let result: ScrapeResultData | null = $state(null);
	let errorMessage: string = $state('');
	let dismissTimeout: ReturnType<typeof setTimeout> | undefined = $state(undefined);

	let hasFeedback = $derived(
		scrapeState === 'success' || scrapeState === 'error' || scrapeState === 'blocked'
	);

	async function triggerScrape() {
		if (scrapeState === 'scraping') return;

		scrapeState = 'scraping';
		result = null;
		errorMessage = '';

		if (dismissTimeout) {
			clearTimeout(dismissTimeout);
			dismissTimeout = undefined;
		}

		try {
			const response = await fetch(`/api/job-boards/${boardId}/search`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' }
			});

			const data: ScrapeResultData = await response.json();
			result = data;

			if (data.scrapeResult?.blocked) {
				scrapeState = 'blocked';
				errorMessage = data.errors[0] ?? 'Access blocked by the job board';
			} else if (data.success) {
				scrapeState = 'success';
				await invalidate('db:job-boards');
			} else {
				scrapeState = 'error';
				errorMessage = data.errors[0] ?? 'Scraping failed';
			}
		} catch (err) {
			scrapeState = 'error';
			errorMessage = err instanceof Error ? err.message : 'Network error';
		}

		dismissTimeout = setTimeout(() => {
			if (scrapeState !== 'scraping') {
				scrapeState = 'idle';
				result = null;
			}
		}, 15_000);
	}

	function dismiss() {
		scrapeState = 'idle';
		result = null;
		if (dismissTimeout) {
			clearTimeout(dismissTimeout);
			dismissTimeout = undefined;
		}
	}
</script>

<!-- Scrape trigger + feedback, rendered as a card footer section -->
<div class="mt-3 flex flex-col gap-2 border-t border-surface-200-800 pt-3">
	<div class="flex items-center justify-between">
		<span class="text-[10px] font-medium tracking-wide uppercase opacity-40">Manual Scrape</span>
		<button
			type="button"
			class="btn gap-1.5 btn-sm"
			class:preset-tonal-primary={scrapeState === 'idle'}
			class:preset-tonal-surface={scrapeState === 'scraping'}
			class:preset-tonal-success={scrapeState === 'success'}
			class:preset-tonal-error={scrapeState === 'error' || scrapeState === 'blocked'}
			disabled={disabled || scrapeState === 'scraping'}
			onclick={triggerScrape}
			title="Manually trigger a scrape of this job board"
		>
			{#if scrapeState === 'scraping'}
				<LoaderCircleIcon class="size-3.5 animate-spin" />
				<span>Scraping…</span>
			{:else if scrapeState === 'success'}
				<CheckCircleIcon class="size-3.5" />
				<span>Done</span>
			{:else if scrapeState === 'blocked'}
				<ShieldAlertIcon class="size-3.5" />
				<span>Blocked</span>
			{:else if scrapeState === 'error'}
				<AlertCircleIcon class="size-3.5" />
				<span>Failed</span>
			{:else}
				<SearchIcon class="size-3.5" />
				<span>Scrape Now</span>
			{/if}
		</button>
	</div>

	<!-- Feedback banner rendered below the button when there's a result -->
	{#if hasFeedback}
		{#if scrapeState === 'success' && result?.scrapeResult}
			<div
				class="flex items-start gap-2 rounded-md border border-success-500/20 bg-success-500/5 px-3 py-2"
			>
				<CheckCircleIcon class="mt-0.5 size-3.5 shrink-0 text-success-500" />
				<div class="min-w-0 flex-1">
					<p class="text-xs font-medium text-success-700 dark:text-success-400">
						Found {result.scrapeResult.total_found} listing{result.scrapeResult.total_found === 1
							? ''
							: 's'}
						&middot; {result.newApplications} new added to Backlog
					</p>
					{#if result.scrapeResult.jobs.length > 0}
						{@const highCount = result.scrapeResult.jobs.filter(
							(j) => j.relevance === 'high'
						).length}
						{@const medCount = result.scrapeResult.jobs.filter(
							(j) => j.relevance === 'medium'
						).length}
						<p class="mt-0.5 text-[10px] opacity-60">
							Relevance: {highCount} high, {medCount} medium, {result.scrapeResult.jobs.length -
								highCount -
								medCount} low
						</p>
					{/if}
					<button
						type="button"
						class="mt-1 text-[10px] text-success-600 underline hover:no-underline dark:text-success-400"
						onclick={dismiss}
					>
						Dismiss
					</button>
				</div>
			</div>
		{/if}

		{#if scrapeState === 'blocked'}
			<div
				class="flex items-start gap-2 rounded-md border border-warning-500/20 bg-warning-500/5 px-3 py-2"
			>
				<ShieldAlertIcon class="mt-0.5 size-3.5 shrink-0 text-warning-500" />
				<div class="min-w-0 flex-1">
					<p class="text-xs font-medium text-warning-700 dark:text-warning-400">
						{errorMessage}
					</p>
					<p class="mt-0.5 text-[10px] opacity-60">
						The job board may require authentication. Ensure Chrome is running with an active
						session.
					</p>
					<button
						type="button"
						class="mt-1 text-[10px] text-warning-600 underline hover:no-underline dark:text-warning-400"
						onclick={dismiss}
					>
						Dismiss
					</button>
				</div>
			</div>
		{/if}

		{#if scrapeState === 'error'}
			<div
				class="flex items-start gap-2 rounded-md border border-error-500/20 bg-error-500/5 px-3 py-2"
			>
				<AlertCircleIcon class="mt-0.5 size-3.5 shrink-0 text-error-500" />
				<div class="min-w-0 flex-1">
					<p class="text-xs font-medium text-error-700 dark:text-error-400">
						{errorMessage}
					</p>
					<button
						type="button"
						class="mt-1 text-[10px] text-error-600 underline hover:no-underline dark:text-error-400"
						onclick={dismiss}
					>
						Dismiss
					</button>
				</div>
			</div>
		{/if}
	{/if}
</div>
