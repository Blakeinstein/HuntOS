<script lang="ts">
	import { UserIcon } from '@lucide/svelte';
	import ProfileFieldCard from './ProfileFieldCard.svelte';
	import { personalFields } from './profile.fields';

	interface Props {
		profileData: Record<string, string | string[]>;
		formState: Record<string, string | string[]>;
		incompleteFields: string[];
		oninput: (key: string, value: string) => void;
	}

	let { profileData, formState, incompleteFields, oninput }: Props = $props();

	function getValue(key: string): string {
		const val = formState[key] ?? profileData[key] ?? '';
		return Array.isArray(val) ? val.join(', ') : val;
	}

	function isIncomplete(key: string): boolean {
		return incompleteFields.includes(key);
	}
</script>

<div class="card border border-surface-200-800 bg-surface-50-950 p-5">
	<h2 class="mb-4 flex items-center gap-2 text-sm font-bold">
		<UserIcon class="size-4 text-primary-500" />
		Personal Information
	</h2>
	<div class="grid gap-4 md:grid-cols-2">
		{#each personalFields as field (field.key)}
			<ProfileFieldCard
				{field}
				value={getValue(field.key)}
				incomplete={isIncomplete(field.key)}
				layout="inline"
				{oninput}
			/>
		{/each}
	</div>
</div>
