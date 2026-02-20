<!--
  ResumeHistory.svelte
  Displays a paginated list of previously generated resumes with actions
  to preview (markdown), download (PDF/MD), and delete entries.
-->
<script lang="ts">
	import { invalidate } from '$app/navigation';
	import {
		FileTextIcon,
		DownloadIcon,
		Trash2Icon,
		SearchIcon,
		ChevronLeftIcon,
		ChevronRightIcon,
		EyeIcon,
		XIcon,
		AlertTriangleIcon,
		LoaderCircleIcon,
		FileWarningIcon,
		CheckCircleIcon,
		FileIcon
	} from '@lucide/svelte';
	import CartaEditor from '$lib/components/CartaEditor.svelte';

	interface HistoryEntry {
		id: number;
		name: string;
		job_description: string;
		template_id: number | null;
		template_name: string;
		model: string;
		data: Record<string, unknown> | null;
		file_path: string;
		pdf_path: string | null;
		file_exists: boolean;
		pdf_exists: boolean;
		duration_ms: number | null;
		created_at: string;
	}

	interface HistoryPage {
		entries: HistoryEntry[];
		total: number;
		limit: number;
		offset: number;
	}

	interface Props {
		history: HistoryPage;
	}

	let { history }: Props = $props();

	// ── Local state ──────────────────────────────────────────────
	let searchQuery = $state('');
	let previewEntry = $state<HistoryEntry | null>(null);
	let previewMarkdown = $state('');
	let previewLoading = $state(false);
	let downloadingId = $state<number | null>(null);
	let deletingId = $state<number | null>(null);
	let isPurging = $state(false);
	let errorMessage = $state('');
	let successMessage = $state('');

	const entries = $derived(history.entries ?? []);
	const total = $derived(history.total ?? 0);
	const limit = $derived(history.limit ?? 20);
	const offset = $derived(history.offset ?? 0);
	const currentPage = $derived(Math.floor(offset / limit) + 1);
	const totalPages = $derived(Math.max(1, Math.ceil(total / limit)));
	const hasNext = $derived(offset + limit < total);
	const hasPrev = $derived(offset > 0);

	// ── Search ───────────────────────────────────────────────────
	let searchTimeout: ReturnType<typeof setTimeout> | undefined;

	function onSearchInput() {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			const url = new URL(window.location.href);
			if (searchQuery.trim()) {
				url.searchParams.set('search', searchQuery.trim());
			} else {
				url.searchParams.delete('search');
			}
			url.searchParams.delete('offset');
			window.history.replaceState({}, '', url.toString());
			invalidate('db:resume-history');
		}, 350);
	}

	// ── Pagination ───────────────────────────────────────────────
	function goToPage(page: number) {
		const url = new URL(window.location.href);
		const newOffset = (page - 1) * limit;
		if (newOffset > 0) {
			url.searchParams.set('offset', String(newOffset));
		} else {
			url.searchParams.delete('offset');
		}
		window.history.replaceState({}, '', url.toString());
		invalidate('db:resume-history');
	}

	// ── Preview ──────────────────────────────────────────────────
	async function openPreview(entry: HistoryEntry) {
		previewEntry = entry;
		previewMarkdown = '';
		previewLoading = true;

		try {
			const res = await fetch(`/api/resumes/history/${entry.id}?include_markdown=true`);
			const result = await res.json();
			if (!res.ok) throw new Error(result.error ?? 'Failed to load preview');
			previewMarkdown = result.markdown ?? '*Markdown file not available on disk.*';
		} catch (err) {
			previewMarkdown = `*Error loading preview: ${err instanceof Error ? err.message : 'Unknown error'}*`;
		} finally {
			previewLoading = false;
		}
	}

	function closePreview() {
		previewEntry = null;
		previewMarkdown = '';
	}

	// ── Download ─────────────────────────────────────────────────
	async function downloadResume(entry: HistoryEntry, format: 'pdf' | 'md' = 'pdf') {
		downloadingId = entry.id;
		errorMessage = '';

		try {
			const res = await fetch(`/api/resumes/history/${entry.id}/download?format=${format}`);
			if (!res.ok) {
				const text = await res.text();
				let msg: string;
				try {
					msg = JSON.parse(text).message ?? text;
				} catch {
					msg = text;
				}
				throw new Error(msg || `Download failed (${res.status})`);
			}

			const blob = await res.blob();
			const ext = format === 'pdf' ? 'pdf' : 'md';
			const safeName = entry.name.replace(/[^\w\s.()-]/g, '').replace(/\s+/g, '_') || 'resume';
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${safeName}.${ext}`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Download failed';
		} finally {
			downloadingId = null;
		}
	}

	// ── Delete ───────────────────────────────────────────────────
	async function deleteEntry(entry: HistoryEntry) {
		if (!confirm(`Delete "${entry.name}"? This will also remove the files from disk.`)) return;

		deletingId = entry.id;
		errorMessage = '';

		try {
			const res = await fetch(`/api/resumes/history/${entry.id}`, { method: 'DELETE' });
			const result = await res.json();
			if (!res.ok) throw new Error(result.error ?? 'Delete failed');

			successMessage = `Deleted "${entry.name}"`;
			setTimeout(() => (successMessage = ''), 3000);

			if (previewEntry?.id === entry.id) closePreview();
			await invalidate('db:resume-history');
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Delete failed';
		} finally {
			deletingId = null;
		}
	}

	async function purgeAll() {
		if (!confirm(`Delete ALL ${total} resume history entries? This cannot be undone.`)) return;

		isPurging = true;
		errorMessage = '';

		try {
			const res = await fetch('/api/resumes/history', { method: 'DELETE' });
			const result = await res.json();
			if (!res.ok) throw new Error(result.error ?? 'Purge failed');

			successMessage = result.message ?? 'All history purged';
			setTimeout(() => (successMessage = ''), 3000);

			closePreview();
			await invalidate('db:resume-history');
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Purge failed';
		} finally {
			isPurging = false;
		}
	}

	// ── Helpers ───────────────────────────────────────────────────
	function formatDate(dateStr: string): string {
		try {
			return new Date(dateStr).toLocaleDateString(undefined, {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			});
		} catch {
			return dateStr;
		}
	}

	function formatDuration(ms: number | null): string {
		if (ms == null) return '';
		if (ms < 1000) return `${ms}ms`;
		return `${(ms / 1000).toFixed(1)}s`;
	}

	function truncate(text: string, max: number): string {
		if (text.length <= max) return text;
		return text.slice(0, max - 3) + '...';
	}
</script>

<div class="space-y-4">
	<!-- Messages -->
	{#if errorMessage}
		<div class="card border border-error-500/30 bg-error-500/10 p-3">
			<p class="flex items-center gap-2 text-sm text-error-500">
				<AlertTriangleIcon class="size-4 shrink-0" />
				{errorMessage}
				<button
					type="button"
					class="ml-auto opacity-60 hover:opacity-100"
					onclick={() => (errorMessage = '')}
				>
					<XIcon class="size-3.5" />
				</button>
			</p>
		</div>
	{/if}

	{#if successMessage}
		<div class="card border border-success-500/30 bg-success-500/10 p-3">
			<p class="flex items-center gap-2 text-sm text-success-500">
				<CheckCircleIcon class="size-4 shrink-0" />
				{successMessage}
			</p>
		</div>
	{/if}

	<!-- Search + Purge bar -->
	<div class="flex items-center gap-3">
		<div class="relative flex-1">
			<SearchIcon class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 opacity-40" />
			<input
				type="text"
				class="input pl-9 text-sm"
				placeholder="Search history by name or job description…"
				bind:value={searchQuery}
				oninput={onSearchInput}
			/>
		</div>

		{#if total > 0}
			<button
				type="button"
				class="btn gap-1.5 preset-tonal-error btn-sm"
				disabled={isPurging}
				onclick={purgeAll}
			>
				{#if isPurging}
					<LoaderCircleIcon class="size-3.5 animate-spin" />
				{:else}
					<Trash2Icon class="size-3.5" />
				{/if}
				Purge All
			</button>
		{/if}
	</div>

	<!-- Empty state -->
	{#if entries.length === 0}
		<div class="flex flex-col items-center justify-center gap-3 py-16 opacity-40">
			<FileIcon class="size-10" />
			<p class="text-sm">
				{searchQuery.trim() ? 'No resumes match your search' : 'No resumes generated yet'}
			</p>
			<p class="text-xs">
				{searchQuery.trim()
					? 'Try a different search term'
					: 'Use the Quick Generate or AI Writer tabs to create your first resume'}
			</p>
		</div>
	{:else}
		<!-- Entry list -->
		<div class="space-y-2">
			{#each entries as entry (entry.id)}
				<div
					class="group card border border-surface-200-800 bg-surface-50-950 p-4 transition-colors hover:border-primary-500/30"
				>
					<div class="flex items-start gap-3">
						<!-- Icon -->
						<div class="mt-0.5 shrink-0">
							{#if !entry.file_exists}
								<FileWarningIcon class="size-5 text-warning-500" />
							{:else if entry.pdf_exists}
								<FileTextIcon class="size-5 text-primary-500" />
							{:else}
								<FileIcon class="size-5 text-surface-400" />
							{/if}
						</div>

						<!-- Content -->
						<div class="min-w-0 flex-1">
							<div class="flex items-start justify-between gap-2">
								<div class="min-w-0">
									<h3 class="truncate text-sm font-bold">{entry.name}</h3>
									<p class="mt-0.5 text-xs opacity-50">
										{formatDate(entry.created_at)}
										{#if entry.duration_ms}
											<span class="mx-1">·</span>
											{formatDuration(entry.duration_ms)}
										{/if}
										<span class="mx-1">·</span>
										{entry.template_name}
									</p>
								</div>

								<!-- Actions -->
								<div class="flex shrink-0 items-center gap-1">
									<!-- Preview -->
									<button
										type="button"
										class="btn-icon btn-icon-sm hover:preset-tonal"
										title="Preview"
										onclick={() => openPreview(entry)}
									>
										<EyeIcon class="size-3.5" />
									</button>

									<!-- Download PDF -->
									<button
										type="button"
										class="btn-icon btn-icon-sm hover:preset-tonal"
										title="Download PDF"
										disabled={downloadingId === entry.id || !entry.file_exists}
										onclick={() => downloadResume(entry, 'pdf')}
									>
										{#if downloadingId === entry.id}
											<LoaderCircleIcon class="size-3.5 animate-spin" />
										{:else}
											<DownloadIcon class="size-3.5" />
										{/if}
									</button>

									<!-- Delete -->
									<button
										type="button"
										class="btn-icon btn-icon-sm hover:preset-tonal-error"
										title="Delete"
										disabled={deletingId === entry.id}
										onclick={() => deleteEntry(entry)}
									>
										{#if deletingId === entry.id}
											<LoaderCircleIcon class="size-3.5 animate-spin" />
										{:else}
											<Trash2Icon class="size-3.5" />
										{/if}
									</button>
								</div>
							</div>

							<!-- Job description snippet -->
							{#if entry.job_description}
								<p class="mt-1.5 text-xs leading-relaxed opacity-40">
									{truncate(entry.job_description, 180)}
								</p>
							{/if}

							<!-- Stats badges -->
							{#if entry.data}
								<div class="mt-2 flex flex-wrap gap-1.5">
									{#if (entry.data.skills as string[])?.length}
										<span class="badge preset-outlined-surface-500 text-[10px]">
											{(entry.data.skills as string[]).length} skills
										</span>
									{/if}
									{#if (entry.data.experience as unknown[])?.length}
										<span class="badge preset-outlined-surface-500 text-[10px]">
											{(entry.data.experience as unknown[]).length} experience
										</span>
									{/if}
									{#if (entry.data.education as unknown[])?.length}
										<span class="badge preset-outlined-surface-500 text-[10px]">
											{(entry.data.education as unknown[]).length} education
										</span>
									{/if}
									{#if entry.pdf_exists}
										<span class="badge preset-filled-primary-500 text-[10px]">PDF</span>
									{/if}
									{#if !entry.file_exists}
										<span class="badge preset-filled-warning-500 text-[10px]">File missing</span>
									{/if}
								</div>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>

		<!-- Pagination -->
		{#if totalPages > 1}
			<div class="flex items-center justify-between pt-2">
				<p class="text-xs opacity-50">
					Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}
				</p>

				<div class="flex items-center gap-1">
					<button
						type="button"
						class="btn-icon btn-icon-sm preset-tonal"
						disabled={!hasPrev}
						onclick={() => goToPage(currentPage - 1)}
					>
						<ChevronLeftIcon class="size-4" />
					</button>

					<span class="px-2 text-xs opacity-60">
						{currentPage} / {totalPages}
					</span>

					<button
						type="button"
						class="btn-icon btn-icon-sm preset-tonal"
						disabled={!hasNext}
						onclick={() => goToPage(currentPage + 1)}
					>
						<ChevronRightIcon class="size-4" />
					</button>
				</div>
			</div>
		{/if}
	{/if}
</div>

<!-- ═══ Preview Modal ═══ -->
{#if previewEntry}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
		onclick={closePreview}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-surface-200-800 bg-surface-50-950 shadow-2xl"
			onclick={(e) => e.stopPropagation()}
		>
			<!-- Modal Header -->
			<div class="flex shrink-0 items-center justify-between border-b border-surface-200-800 px-5 py-3">
				<div class="min-w-0 flex-1">
					<h3 class="truncate text-sm font-bold">{previewEntry.name}</h3>
					<p class="text-xs opacity-50">
						{formatDate(previewEntry.created_at)}
						<span class="mx-1">·</span>
						{previewEntry.template_name}
					</p>
				</div>

				<div class="flex shrink-0 items-center gap-2">
					<!-- Download buttons -->
					<button
						type="button"
						class="btn gap-1.5 preset-tonal btn-sm"
						disabled={!previewEntry.file_exists}
						onclick={() => previewEntry && downloadResume(previewEntry, 'md')}
					>
						<DownloadIcon class="size-3.5" />
						Markdown
					</button>
					<button
						type="button"
						class="btn gap-1.5 preset-filled-primary-500 btn-sm"
						disabled={!previewEntry.file_exists}
						onclick={() => previewEntry && downloadResume(previewEntry, 'pdf')}
					>
						<DownloadIcon class="size-3.5" />
						PDF
					</button>

					<button
						type="button"
						class="btn-icon btn-icon-sm hover:preset-tonal"
						onclick={closePreview}
					>
						<XIcon class="size-4" />
					</button>
				</div>
			</div>

			<!-- Modal Body — CartaEditor in preview mode -->
			<div class="min-h-0 flex-1 overflow-hidden">
				{#if previewLoading}
					<div class="flex items-center justify-center py-20">
						<LoaderCircleIcon class="size-8 animate-spin text-primary-500" />
					</div>
				{:else}
					<div class="h-full">
						<CartaEditor
							value={previewMarkdown}
							initialTab="preview"
							disableToolbar
							class="h-full"
						/>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
