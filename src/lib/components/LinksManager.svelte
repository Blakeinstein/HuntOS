<script lang="ts">
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
		LinkedinIcon
	} from '@lucide/svelte';
	import type { ProfileLink } from '$lib/services/types';

	interface Props {
		links: ProfileLink[];
		onchange?: (links: ProfileLink[]) => void;
	}

	let { links: externalLinks = [], onchange }: Props = $props();

	// Local overrides applied after saves; reset when parent prop changes
	let localOverride = $state<ProfileLink[] | null>(null);
	let links = $derived<ProfileLink[]>(localOverride ?? externalLinks);

	let editingId = $state<string | null>(null);
	let editDraft = $state<ProfileLink>({ id: '', title: '', url: '', description: '' });
	let isAdding = $state(false);
	let newLink = $state<ProfileLink>({ id: '', title: '', url: '', description: '' });
	let isSaving = $state(false);
	let saveMessage = $state('');

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
		newLink = {
			id: generateId(),
			title,
			url: '',
			description
		};
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

	<!-- Quick add suggestions (only when not currently adding) -->
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
					<!-- Read-only link row -->
					<div
						class="group flex items-start gap-3 rounded-lg border border-surface-200-800 bg-surface-50-950 p-3 transition-colors hover:border-surface-300-700"
					>
						<div class="mt-0.5 text-surface-400">
							<GripVerticalIcon
								class="size-4 opacity-0 transition-opacity group-hover:opacity-40"
							/>
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<LinkIcon class="size-3.5 shrink-0 text-primary-500" />
								<span class="text-sm font-semibold">{link.title}</span>
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
						</div>
						<div class="flex shrink-0 gap-1">
							<button
								type="button"
								class="btn-icon btn-icon-sm opacity-0 transition-opacity group-hover:opacity-100 hover:text-primary-500"
								title="Edit link"
								onclick={() => startEdit(link)}
							>
								<PencilIcon class="size-3.5" />
							</button>
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
				{/if}
			{/each}
		</div>
	{/if}
</div>
