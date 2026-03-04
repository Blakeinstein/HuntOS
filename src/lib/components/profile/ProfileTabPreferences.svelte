<script lang="ts">
	import { preferencesFields } from './profile.fields';
	import ProfileFieldCard from './ProfileFieldCard.svelte';

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

<div class="space-y-4">
	{#each preferencesFields as field (field.key)}
		<ProfileFieldCard
			{field}
			value={getValue(field.key)}
			incomplete={isIncomplete(field.key)}
			layout="card"
			{oninput}
		/>
	{/each}
</div>
