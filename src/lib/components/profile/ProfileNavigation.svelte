<script lang="ts">
	import {
		MessageSquareIcon,
		FileTextIcon,
		UserIcon,
		TargetIcon,
		ShieldCheckIcon,
		BriefcaseIcon,
		LinkIcon,
		NotebookPenIcon,
		SlidersHorizontalIcon
	} from '@lucide/svelte';

	export type NavGroup = 'assistant' | 'profile' | 'extras';

	interface Props {
		activeGroup: NavGroup;
		activeTab: string;
		documentCount?: number;
		onswitchgroup: (group: NavGroup) => void;
		onswitchtab: (tab: string) => void;
	}

	let { activeGroup, activeTab, documentCount = 0, onswitchgroup, onswitchtab }: Props = $props();

	const assistantTabs = [
		{ value: 'chat',      label: 'AI Builder', Icon: MessageSquareIcon },
		{ value: 'documents', label: 'Documents',  Icon: FileTextIcon }
	];

	const profileTabs = [
		{ value: 'personal',     label: 'Personal',     Icon: UserIcon },
		{ value: 'preferences',  label: 'Preferences',  Icon: TargetIcon },
		{ value: 'work-auth',    label: 'Work Auth',    Icon: ShieldCheckIcon },
		{ value: 'professional', label: 'Professional', Icon: BriefcaseIcon }
	];

	const extrasTabs = [
		{ value: 'links', label: 'Links', Icon: LinkIcon },
		{ value: 'notes', label: 'Notes', Icon: NotebookPenIcon }
	];

	const secondaryTabs = $derived(
		activeGroup === 'assistant' ? assistantTabs :
		activeGroup === 'profile'   ? profileTabs   :
		                              extrasTabs
	);
</script>

<!-- Level 1 — group pill strip -->
<div class="flex items-stretch gap-1 rounded-xl border border-surface-200-800 bg-surface-100-900 p-1">
	<button
		type="button"
		onclick={() => onswitchgroup('assistant')}
		class="flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all
			{activeGroup === 'assistant'
			? 'bg-surface-50-950 text-primary-500 shadow-sm'
			: 'opacity-60 hover:bg-surface-200-800 hover:opacity-90'}"
	>
		<MessageSquareIcon class="size-4 shrink-0" />
		<span>Assistant</span>
	</button>

	<div class="w-px self-stretch bg-surface-200-800"></div>

	<button
		type="button"
		onclick={() => onswitchgroup('profile')}
		class="flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all
			{activeGroup === 'profile'
			? 'bg-surface-50-950 text-primary-500 shadow-sm'
			: 'opacity-60 hover:bg-surface-200-800 hover:opacity-90'}"
	>
		<UserIcon class="size-4 shrink-0" />
		<span>Profile</span>
	</button>

	<div class="w-px self-stretch bg-surface-200-800"></div>

	<button
		type="button"
		onclick={() => onswitchgroup('extras')}
		class="flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all
			{activeGroup === 'extras'
			? 'bg-surface-50-950 text-primary-500 shadow-sm'
			: 'opacity-60 hover:bg-surface-200-800 hover:opacity-90'}"
	>
		<SlidersHorizontalIcon class="size-4 shrink-0" />
		<span>Links &amp; Notes</span>
	</button>
</div>

<!-- Level 2 — secondary underline tab strip -->
<div class="flex flex-wrap items-center gap-1 border-b border-surface-200-800">
	{#each secondaryTabs as tab (tab.value)}
		<button
			type="button"
			onclick={() => onswitchtab(tab.value)}
			class="relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors
				{activeTab === tab.value ? 'text-primary-500' : 'opacity-50 hover:opacity-80'}"
		>
			<tab.Icon class="size-3.5 shrink-0" />
			{tab.label}
			{#if tab.value === 'documents' && documentCount > 0}
				<span class="ml-0.5 rounded-full bg-primary-500/20 px-1.5 py-0.5 text-[10px] font-bold text-primary-500">
					{documentCount}
				</span>
			{/if}
			{#if activeTab === tab.value}
				<span class="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary-500"></span>
			{/if}
		</button>
	{/each}
</div>
