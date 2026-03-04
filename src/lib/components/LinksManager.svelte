<script lang="ts">
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import {
		LinkIcon,
		PlusIcon,
		TrashIcon,
		PencilIcon,
		CheckIcon,
		XIcon,
		GripVerticalIcon,
		GithubIcon,
		GlobeIcon,
		LinkedinIcon,
		SparklesIcon,
		RefreshCwIcon,
		ClockIcon,
		AlertCircleIcon,
		LoaderIcon,
		CheckCircle2Icon,
		LockIcon,
		ExternalLinkIcon,
		RotateCcwIcon
	} from '@lucide/svelte';
	import type { ProfileLink, LinkSummary } from '$lib/services/types';

	interface Props {
		links: ProfileLink[];
		summaries?: LinkSummary[];
		onchange?: (links: ProfileLink[]) => void;
	}

	let { links: externalLinks = [], summaries: externalSummaries = [], onchange }: Props = $props();

	// ── Links state ──────────────────────────────────────────────────
	let localOverride = $state<ProfileLink[] | null>(null);
	let links = $derived<ProfileLink[]>(localOverride ?? externalLinks);

	let editingId = $state<string | null>(null);
	let editDraft = $state<ProfileLink>({ id: '', title: '', url: '', description: '' });
	let isAdding = $state(false);
	let newLink = $state<ProfileLink>({ id: '', title: '', url: '', description: '' });
	let isSaving = $state(false);
	let saveMessage = $state('');

	// ── Summary state ────────────────────────────────────────────────
	// localSummaries is a SvelteMap kept in sync with server data + poll updates.
	// SvelteMap is already reactive — no $state wrapper needed.
	const localSummaries = new SvelteMap<string, LinkSummary>();

	// Sync prop changes (e.g. SvelteKit re-running the load function after invalidate)
	// back into localSummaries so previously-generated summaries appear on first render.
	$effect(() => {
		const incoming = externalSummaries; // track the reactive prop
		for (const s of incoming) {
			const key = s.link_title.toLowerCase();
			// Only overwrite if the incoming record is newer than what we have locally
			const existing = localSummaries.get(key);
			if (!existing || s.updated_at >= existing.updated_at) {
				localSummaries.set(key, s);
			}
		}
		// Remove stale keys that are no longer in the server data
		const incomingKeys = new Set(incoming.map((s) => s.link_title.toLowerCase()));
		for (const k of localSummaries.keys()) {
			if (!incomingKeys.has(k)) localSummaries.delete(k);
		}
	});

	// Track which links have their summary panel expanded
	const expandedSummaries = new SvelteSet<string>();

	// Track in-flight summarise requests (by normalised title)
	const summarising = new SvelteSet<string>();

	// Track links where we've clicked "Open in Browser" (by normalised title)
	const openingBrowser = new SvelteSet<string>();

	// Derived: whether any jobs are active (used to trigger polling)
	const hasActiveJobs = $derived(
		[...localSummaries.values()].some((s) => s.status === 'pending' || s.status === 'running')
	);

	// Poll interval handle
	let pollHandle: ReturnType<typeof setInterval> | null = null;

	$effect(() => {
		if (hasActiveJobs && !pollHandle) {
			pollHandle = setInterval(pollSummaries, 3000);
		} else if (!hasActiveJobs && pollHandle) {
			clearInterval(pollHandle);
			pollHandle = null;
		}
		return () => {
			if (pollHandle) {
				clearInterval(pollHandle);
				pollHandle = null;
			}
		};
	});

	function getSummary(title: string): LinkSummary | null {
		return localSummaries.get(title.toLowerCase()) ?? null;
	}

	function buildSummaryMap(summaries: LinkSummary[]): SvelteMap<string, LinkSummary> {
		return new SvelteMap(summaries.map((s) => [s.link_title.toLowerCase(), s]));
	}

	function formatRelativeTime(isoDate: string | null): string {
		if (!isoDate) return 'Never';
		const date = new Date(isoDate);
		const now = Date.now();
		const diffMs = now - date.getTime();
		const diffSec = Math.floor(diffMs / 1000);
		if (diffSec < 60) return 'Just now';
		const diffMin = Math.floor(diffSec / 60);
		if (diffMin < 60) return `${diffMin}m ago`;
		const diffHr = Math.floor(diffMin / 60);
		if (diffHr < 24) return `${diffHr}h ago`;
		const diffDays = Math.floor(diffHr / 24);
		return `${diffDays}d ago`;
	}

	// ── Polling ──────────────────────────────────────────────────────

	async function pollSummaries() {
		try {
			const res = await fetch('/api/profiles/links/summarize');
			if (!res.ok) return;
			const data = await res.json();
			if (Array.isArray(data.summaries)) {
				const updated = buildSummaryMap(data.summaries as LinkSummary[]);
				// Merge into localSummaries so reactivity fires
				for (const [k, v] of updated) {
					localSummaries.set(k, v);
				}
				// Remove any keys no longer present
				for (const k of localSummaries.keys()) {
					if (!updated.has(k)) localSummaries.delete(k);
				}
			}
		} catch {
			// Silently ignore network errors during polling
		}
	}

	// ── Summarise ────────────────────────────────────────────────────

	async function enqueueSummarise(link: ProfileLink) {
		if (!link.url) return;
		const key = link.title.toLowerCase();
		summarising.add(key);

		try {
			const res = await fetch('/api/profiles/links/summarize', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ title: link.title, url: link.url })
			});
			const data = await res.json();
			if (data.summary) {
				localSummaries.set(key, data.summary as LinkSummary);
			}
		} catch (err) {
			console.error('Failed to enqueue summarise job', err);
		} finally {
			summarising.delete(key);
		}
	}

	async function openInBrowser(link: ProfileLink) {
		if (!link.url) return;
		const key = link.title.toLowerCase();
		openingBrowser.add(key);
		try {
			await fetch('/api/profiles/links/open-browser', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ url: link.url })
			});
		} catch (err) {
			console.error('Failed to open browser', err);
		} finally {
			openingBrowser.delete(key);
		}
	}

	function toggleSummaryPanel(title: string) {
		const key = title.toLowerCase();
		if (expandedSummaries.has(key)) {
			expandedSummaries.delete(key);
		} else {
			expandedSummaries.add(key);
		}
	}

	function isSummaryExpanded(title: string): boolean {
		return expandedSummaries.has(title.toLowerCase());
	}

	// ── Links CRUD ───────────────────────────────────────────────────

	function generateId(): string {
		return `link_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	}

	async function persistLinks(updated: ProfileLink[]) {
		isSaving = true;
		saveMessage = '';
		try {
			const res = await fetch('/api/profiles/links', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(updated)
			});
			if (!res.ok) {
				const data = await res.json();
				saveMessage = data.error ?? 'Failed to save';
				return;
			}
			localOverride = updated;
			onchange?.(updated);
			saveMessage = '';
		} catch (err) {
			saveMessage = err instanceof Error ? err.message : 'Network error';
		} finally {
			isSaving = false;
		}
	}

	function startEdit(link: ProfileLink) {
		editingId = link.id;
		editDraft = { ...link };
	}

	function cancelEdit() {
		editingId = null;
		editDraft = { id: '', title: '', url: '', description: '' };
	}

	async function saveEdit() {
		if (!editDraft.title.trim()) return;
		const updated = links.map((l) => (l.id === editingId ? { ...editDraft } : l));
		editingId = null;
		await persistLinks(updated);
	}

	function startAdd() {
		isAdding = true;
		newLink = { id: generateId(), title: '', url: '', description: '' };
	}

	function cancelAdd() {
		isAdding = false;
		newLink = { id: '', title: '', url: '', description: '' };
	}

	async function confirmAdd() {
		if (!newLink.title.trim()) return;
		const updated = [...links, { ...newLink }];
		isAdding = false;
		await persistLinks(updated);
	}

	async function removeLink(id: string) {
		const updated = links.filter((l) => l.id !== id);
		await persistLinks(updated);
	}

	function quickAdd(title: string, _urlPlaceholder: string, description: string) {
		isAdding = true;
		newLink = { id: generateId(), title, url: '', description };
	}
</script>

<div class="space-y-4">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<h2 class="flex items-center gap-2 text-sm font-bold">
			<LinkIcon class="size-4 text-primary-500" />
			Online Profiles & Links
		</h2>
		<button
			type="button"
			class="btn gap-1.5 preset-filled-primary-500 btn-sm"
			onclick={startAdd}
			disabled={isAdding}
		>
			<PlusIcon class="size-3.5" />
			Add Link
		</button>
	</div>

	<!-- Quick add suggestions -->
	{#if !isAdding}
		{@const hasLinkedin = links.some((l) => l.title.toLowerCase().includes('linkedin'))}
		{@const hasGithub = links.some((l) => l.title.toLowerCase().includes('github'))}
		{@const hasPortfolio = links.some((l) => l.title.toLowerCase().includes('portfolio'))}

		{#if !hasLinkedin || !hasGithub || !hasPortfolio}
			<div class="flex flex-wrap items-center gap-2">
				<span class="text-xs opacity-50">Quick add:</span>
				{#if !hasLinkedin}
					<button
						type="button"
						class="btn gap-1 preset-outlined-surface-500 btn-sm"
						onclick={() =>
							quickAdd('LinkedIn', 'https://linkedin.com/in/yourname', 'My professional profile')}
					>
						<LinkedinIcon class="size-3.5" />
						LinkedIn
					</button>
				{/if}
				{#if !hasGithub}
					<button
						type="button"
						class="btn gap-1 preset-outlined-surface-500 btn-sm"
						onclick={() =>
							quickAdd(
								'GitHub',
								'https://github.com/yourname',
								'My open-source projects and code repositories'
							)}
					>
						<GithubIcon class="size-3.5" />
						GitHub
					</button>
				{/if}
				{#if !hasPortfolio}
					<button
						type="button"
						class="btn gap-1 preset-outlined-surface-500 btn-sm"
						onclick={() =>
							quickAdd(
								'Portfolio',
								'https://yourportfolio.com',
								'My personal portfolio showcasing my work'
							)}
					>
						<GlobeIcon class="size-3.5" />
						Portfolio
					</button>
				{/if}
			</div>
		{/if}
	{/if}

	<!-- Status messages -->
	{#if isSaving}
		<p class="text-xs text-primary-500">Saving...</p>
	{/if}
	{#if saveMessage}
		<p class="text-xs text-error-500">{saveMessage}</p>
	{/if}

	<!-- Add new link form -->
	{#if isAdding}
		<div class="space-y-3 card border-2 border-dashed border-primary-500/40 bg-primary-500/5 p-4">
			<p class="text-xs font-semibold tracking-wide text-primary-500 uppercase">New Link</p>
			<div class="grid gap-3 sm:grid-cols-2">
				<label class="label">
					<span class="text-xs font-medium">Title <span class="text-error-500">*</span></span>
					<input
						type="text"
						class="mt-1 input"
						placeholder="e.g. GitHub, Portfolio, Blog"
						bind:value={newLink.title}
					/>
				</label>
				<label class="label">
					<span class="text-xs font-medium">URL</span>
					<input type="url" class="mt-1 input" placeholder="https://..." bind:value={newLink.url} />
				</label>
			</div>
			<label class="label">
				<span class="text-xs font-medium">Description</span>
				<input
					type="text"
					class="mt-1 input"
					placeholder="A brief description of this link"
					bind:value={newLink.description}
				/>
			</label>
			<div class="flex justify-end gap-2">
				<button
					type="button"
					class="btn gap-1 preset-outlined-surface-500 btn-sm"
					onclick={cancelAdd}
				>
					<XIcon class="size-3.5" />
					Cancel
				</button>
				<button
					type="button"
					class="btn gap-1 preset-filled-primary-500 btn-sm"
					disabled={!newLink.title.trim()}
					onclick={confirmAdd}
				>
					<CheckIcon class="size-3.5" />
					Add
				</button>
			</div>
		</div>
	{/if}

	<!-- Links list -->
	{#if links.length === 0 && !isAdding}
		<div class="rounded-lg border border-dashed border-surface-300-700 px-6 py-10 text-center">
			<LinkIcon class="mx-auto size-8 opacity-20" />
			<p class="mt-2 text-sm opacity-50">No links yet. Add your first link above.</p>
		</div>
	{:else}
		<div class="space-y-2">
			{#each links as link (link.id)}
				{@const summary = getSummary(link.title)}
				{@const needsLogin = summary?.status === 'needs_login'}
				{@const isOpeningBrowser = openingBrowser.has(link.title.toLowerCase())}
				{@const isEnqueuing = summarising.has(link.title.toLowerCase())}
				{@const isJobActive =
					isEnqueuing || summary?.status === 'pending' || summary?.status === 'running'}
				{@const hasSummary = summary?.status === 'done' && !!summary.summary}
				{@const summaryExpanded = isSummaryExpanded(link.title)}

				{#if editingId === link.id}
					<!-- Inline edit form -->
					<div class="space-y-3 card border border-primary-500/40 bg-surface-50-950 p-4">
						<div class="grid gap-3 sm:grid-cols-2">
							<label class="label">
								<span class="text-xs font-medium">Title <span class="text-error-500">*</span></span>
								<input type="text" class="mt-1 input" bind:value={editDraft.title} />
							</label>
							<label class="label">
								<span class="text-xs font-medium">URL</span>
								<input
									type="url"
									class="mt-1 input"
									placeholder="https://..."
									bind:value={editDraft.url}
								/>
							</label>
						</div>
						<label class="label">
							<span class="text-xs font-medium">Description</span>
							<input type="text" class="mt-1 input" bind:value={editDraft.description} />
						</label>
						<div class="flex justify-end gap-2">
							<button
								type="button"
								class="btn gap-1 preset-outlined-surface-500 btn-sm"
								onclick={cancelEdit}
							>
								<XIcon class="size-3.5" />
								Cancel
							</button>
							<button
								type="button"
								class="btn gap-1 preset-filled-primary-500 btn-sm"
								disabled={!editDraft.title.trim()}
								onclick={saveEdit}
							>
								<CheckIcon class="size-3.5" />
								Save
							</button>
						</div>
					</div>
				{:else}
					<!-- Read-only link card -->
					<div
						class="rounded-lg border border-surface-200-800 bg-surface-50-950 transition-colors hover:border-surface-300-700"
					>
						<!-- Main row -->
						<div class="group flex items-start gap-3 p-3">
							<div class="mt-0.5 text-surface-400">
								<GripVerticalIcon
									class="size-4 opacity-0 transition-opacity group-hover:opacity-40"
								/>
							</div>

							<!-- Link info -->
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<LinkIcon class="size-3.5 shrink-0 text-primary-500" />
									<span class="text-sm font-semibold">{link.title}</span>

									<!-- Summary status badge -->
									{#if isJobActive}
										<span
											class="inline-flex items-center gap-1 rounded-full bg-warning-500/15 px-2 py-0.5 text-[10px] font-semibold text-warning-600 dark:text-warning-400"
										>
											<LoaderIcon class="size-3 animate-spin" />
											{summary?.status === 'running' ? 'Summarising…' : 'Queued'}
										</span>
									{:else if summary?.status === 'done'}
										<span
											class="inline-flex items-center gap-1 rounded-full bg-success-500/15 px-2 py-0.5 text-[10px] font-semibold text-success-600 dark:text-success-400"
										>
											<CheckCircle2Icon class="size-3" />
											Summarised
										</span>
									{:else if summary?.status === 'error'}
										<span
											class="inline-flex items-center gap-1 rounded-full bg-error-500/15 px-2 py-0.5 text-[10px] font-semibold text-error-600 dark:text-error-400"
											title={summary.error_message ?? 'An error occurred'}
										>
											<AlertCircleIcon class="size-3" />
											Error
										</span>
									{:else if needsLogin}
										<span
											class="inline-flex items-center gap-1 rounded-full bg-warning-500/15 px-2 py-0.5 text-[10px] font-semibold text-warning-600 dark:text-warning-400"
											title="Sign in to LinkedIn and retry"
										>
											<LockIcon class="size-3" />
											Login required
										</span>
									{/if}
								</div>

								{#if link.url}
									<a
										href={link.url}
										target="_blank"
										rel="external noopener noreferrer"
										class="mt-0.5 block truncate text-xs text-primary-500 underline decoration-primary-500/30 hover:decoration-primary-500"
									>
										{link.url}
									</a>
								{:else}
									<p class="mt-0.5 text-xs italic opacity-30">No URL set</p>
								{/if}

								{#if link.description}
									<p class="mt-1 text-xs opacity-60">{link.description}</p>
								{/if}

								<!-- Last generated timestamp -->
								{#if summary?.generated_at}
									<p class="mt-1 flex items-center gap-1 text-[10px] opacity-40">
										<ClockIcon class="size-3" />
										Last summarised: {formatRelativeTime(summary.generated_at)}
									</p>
								{/if}

								<!-- Error message -->
								{#if summary?.status === 'error' && summary.error_message}
									<p class="mt-1 text-[10px] text-error-500">
										{summary.error_message}
									</p>
								{/if}

								<!-- LinkedIn login-required CTA -->
								{#if needsLogin}
									<div
										class="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-warning-500/30 bg-warning-500/5 px-2.5 py-2"
									>
										<LockIcon class="size-3.5 shrink-0 text-warning-500" />
										<p class="min-w-0 flex-1 text-[11px] text-warning-700 dark:text-warning-400">
											LinkedIn requires you to be signed in. Open it in your browser, log in, then
											click <strong>Retry</strong>.
										</p>
										<div class="flex shrink-0 items-center gap-1.5">
											<button
												type="button"
												class="btn gap-1 preset-outlined-warning-500 btn-sm"
												title="Open LinkedIn in your browser"
												disabled={isOpeningBrowser}
												onclick={() => openInBrowser(link)}
											>
												{#if isOpeningBrowser}
													<LoaderIcon class="size-3.5 animate-spin" />
													<span>Opening…</span>
												{:else}
													<ExternalLinkIcon class="size-3.5" />
													<span>Open in browser</span>
												{/if}
											</button>
											<button
												type="button"
												class="btn gap-1 preset-outlined-surface-500 btn-sm"
												title="Retry summarisation after signing in"
												disabled={isEnqueuing}
												onclick={() => enqueueSummarise(link)}
											>
												<RotateCcwIcon class="size-3.5" />
												<span>Retry</span>
											</button>
										</div>
									</div>
								{/if}
							</div>

							<!-- Actions -->
							<div class="flex shrink-0 items-center gap-1">
								<!-- Summarise / Re-summarise button -->
								{#if link.url}
									<button
										type="button"
										class="btn gap-1 btn-sm"
										class:preset-outlined-surface-500={!hasSummary && !needsLogin}
										class:preset-outlined-success-500={hasSummary}
										class:preset-outlined-warning-500={needsLogin}
										title={needsLogin
											? 'Retry after signing in to LinkedIn'
											: hasSummary
												? 'Re-summarise this link'
												: 'Summarise this link with AI'}
										disabled={isJobActive}
										onclick={() => enqueueSummarise(link)}
									>
										{#if isJobActive}
											<LoaderIcon class="size-3.5 animate-spin" />
											<span class="hidden sm:inline"
												>{summary?.status === 'running' ? 'Running…' : 'Queued'}</span
											>
										{:else if needsLogin}
											<RotateCcwIcon class="size-3.5" />
											<span class="hidden sm:inline">Retry</span>
										{:else if hasSummary}
											<RefreshCwIcon class="size-3.5" />
											<span class="hidden sm:inline">Re-summarise</span>
										{:else}
											<SparklesIcon class="size-3.5" />
											<span class="hidden sm:inline">Summarise</span>
										{/if}
									</button>
								{/if}

								<!-- View summary toggle -->
								{#if hasSummary}
									<button
										type="button"
										class="btn gap-1 preset-outlined-surface-500 btn-sm"
										title={summaryExpanded ? 'Hide summary' : 'View summary'}
										onclick={() => toggleSummaryPanel(link.title)}
									>
										{summaryExpanded ? 'Hide' : 'View'}
									</button>
								{/if}

								<!-- Edit -->
								<button
									type="button"
									class="btn-icon btn-icon-sm opacity-0 transition-opacity group-hover:opacity-100 hover:text-primary-500"
									title="Edit link"
									onclick={() => startEdit(link)}
								>
									<PencilIcon class="size-3.5" />
								</button>

								<!-- Delete -->
								<button
									type="button"
									class="btn-icon btn-icon-sm opacity-0 transition-opacity group-hover:opacity-100 hover:text-error-500"
									title="Remove link"
									onclick={() => removeLink(link.id)}
								>
									<TrashIcon class="size-3.5" />
								</button>
							</div>
						</div>

						<!-- Expandable summary panel -->
						{#if summaryExpanded && hasSummary}
							<div class="border-t border-surface-200-800 bg-surface-100-900 px-4 pt-3 pb-4">
								<div class="mb-2 flex items-center justify-between">
									<p class="text-xs font-semibold opacity-60">AI Summary</p>
									{#if summary?.generated_at}
										<p class="flex items-center gap-1 text-[10px] opacity-40">
											<ClockIcon class="size-3" />
											Generated {formatRelativeTime(summary.generated_at)}
										</p>
									{/if}
								</div>
								<pre
									class="max-h-64 overflow-y-auto rounded-md bg-surface-200-800 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">{summary!
										.summary}</pre>
							</div>
						{/if}
					</div>
				{/if}
			{/each}
		</div>
	{/if}
</div>
