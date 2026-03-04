<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { SaveIcon, CheckCircleIcon } from '@lucide/svelte';
	import type { LinkSummary } from '$lib/services/types';

	import ProfileChat from '$lib/components/ProfileChat.svelte';
	import DocumentsPanel from '$lib/components/DocumentsPanel.svelte';
	import LinksManager from '$lib/components/LinksManager.svelte';
	import ProfileCompletenessBar from '$lib/components/profile/ProfileCompletenessBar.svelte';
	import ProfileNavigation from '$lib/components/profile/ProfileNavigation.svelte';
	import ProfileTabPersonal from '$lib/components/profile/ProfileTabPersonal.svelte';
	import ProfileTabPreferences from '$lib/components/profile/ProfileTabPreferences.svelte';
	import ProfileTabWorkAuth from '$lib/components/profile/ProfileTabWorkAuth.svelte';
	import ProfileTabProfessional from '$lib/components/profile/ProfileTabProfessional.svelte';
	import ProfileTabNotes from '$lib/components/profile/ProfileTabNotes.svelte';
	import type { NavGroup } from '$lib/components/profile/ProfileNavigation.svelte';

	let { data } = $props();

	const completeness = $derived(data.completeness ?? 0);
	const incompleteFields = $derived(data.incompleteFields ?? []);
	const profileData = $derived(data.profile ?? {});
	const documents = $derived(data.documents ?? []);
	const profileLinks = $derived(data.profileLinks ?? []);
	const linkSummaries = $derived<LinkSummary[]>(
		((data as Record<string, unknown>).linkSummaries as LinkSummary[]) ?? []
	);

	// ── Form state ────────────────────────────────────────────────────────────
	// Unsaved edits accumulate here; merged with profileData on read, flushed on save.
	let formState = $state<Record<string, string | string[]>>({});
	let isSaving = $state(false);
	let saveSuccess = $state(false);

	function handleInput(key: string, value: string) {
		formState = { ...formState, [key]: value };
	}

	async function saveProfile() {
		if (Object.keys(formState).length === 0) return;

		isSaving = true;
		saveSuccess = false;

		try {
			const res = await fetch('/api/profiles', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(formState)
			});

			if (!res.ok) {
				const err = await res.json().catch(() => ({ error: 'Unknown error' }));
				console.error('Failed to save profile:', err.error ?? err);
				return;
			}

			saveSuccess = true;
			formState = {};
			await invalidate('db:profile');
			setTimeout(() => (saveSuccess = false), 3000);
		} finally {
			isSaving = false;
		}
	}

	// ── Two-level navigation ──────────────────────────────────────────────────
	const groupDefaults: Record<NavGroup, string> = {
		assistant: 'chat',
		profile: 'personal',
		extras: 'links'
	};

	const tabGroup: Record<string, NavGroup> = {
		chat: 'assistant',
		documents: 'assistant',
		personal: 'profile',
		preferences: 'profile',
		'work-auth': 'profile',
		professional: 'profile',
		links: 'extras',
		notes: 'extras'
	};

	let activeTab = $state('chat');
	let activeGroup = $state<NavGroup>('assistant');

	// Remember last active leaf per group so switching back restores context
	const lastTabInGroup: Partial<Record<NavGroup, string>> = {};

	function switchGroup(group: NavGroup) {
		activeGroup = group;
		activeTab = lastTabInGroup[group] ?? groupDefaults[group];
	}

	function setTab(tab: string) {
		activeTab = tab;
		const g = tabGroup[tab] ?? 'assistant';
		activeGroup = g;
		lastTabInGroup[g] = tab;
	}

	// Show the Save button only on editable profile tabs
	const showSave = $derived(activeGroup !== 'assistant' && activeTab !== 'links');
</script>

<div class="mx-auto max-w-4xl space-y-6">
	<!-- Page header -->
	<div class="flex items-start justify-between gap-4">
		<div>
			<h1 class="h3 font-bold">Profile</h1>
			<p class="text-sm opacity-60">
				Build your profile with the AI assistant, upload documents, or edit details manually.
			</p>
		</div>
		{#if showSave}
			<button
				type="button"
				class="btn gap-2 preset-filled-primary-500"
				disabled={isSaving}
				onclick={saveProfile}
			>
				{#if isSaving}
					<span class="animate-spin">⏳</span>
					<span>Saving...</span>
				{:else if saveSuccess}
					<CheckCircleIcon class="size-4" />
					<span>Saved!</span>
				{:else}
					<SaveIcon class="size-4" />
					<span>Save Profile</span>
				{/if}
			</button>
		{/if}
	</div>

	<!-- Completeness bar -->
	<ProfileCompletenessBar {completeness} {incompleteFields} />

	<!-- Two-level navigation -->
	<ProfileNavigation
		{activeGroup}
		{activeTab}
		documentCount={documents.length}
		onswitchgroup={switchGroup}
		onswitchtab={setTab}
	/>

	<!-- Tab content -->
	{#if activeTab === 'chat'}
		<ProfileChat />
	{:else if activeTab === 'documents'}
		<DocumentsPanel {documents} />
	{:else if activeTab === 'personal'}
		<ProfileTabPersonal {profileData} {formState} {incompleteFields} oninput={handleInput} />
	{:else if activeTab === 'preferences'}
		<ProfileTabPreferences {profileData} {formState} {incompleteFields} oninput={handleInput} />
	{:else if activeTab === 'work-auth'}
		<ProfileTabWorkAuth {profileData} {formState} {incompleteFields} oninput={handleInput} />
	{:else if activeTab === 'professional'}
		<ProfileTabProfessional {profileData} {formState} {incompleteFields} oninput={handleInput} />
	{:else if activeTab === 'links'}
		<div class="card border border-surface-200-800 bg-surface-50-950 p-5">
			<LinksManager links={profileLinks} summaries={linkSummaries} />
		</div>
	{:else if activeTab === 'notes'}
		<ProfileTabNotes {profileData} {formState} {incompleteFields} oninput={handleInput} />
	{/if}
</div>
