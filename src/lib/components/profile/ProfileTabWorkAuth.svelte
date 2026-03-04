<script lang="ts">
	import { IdCardIcon } from '@lucide/svelte';
	import ProfileFieldCard from './ProfileFieldCard.svelte';
	import { workAuthFields } from './profile.fields';

	interface Props {
		profileData: Record<string, string | string[]>;
		formState: Record<string, string | string[]>;
		incompleteFields: string[];
		oninput: (key: string, value: string) => void;
	}

	let { profileData, formState, incompleteFields, oninput }: Props = $props();

	/** Merged view of saved + in-flight form state, used for showIf predicates. */
	const mergedData = $derived({ ...profileData, ...formState });

	function getValue(key: string): string {
		const val = formState[key] ?? profileData[key] ?? '';
		return Array.isArray(val) ? val.join(', ') : val;
	}

	function isIncomplete(key: string): boolean {
		return incompleteFields.includes(key);
	}

	function isVisible(field: (typeof workAuthFields)[number]): boolean {
		if (!field.showIf) return true;
		return field.showIf(mergedData);
	}
</script>

<div class="space-y-4">
	<!-- Section explainer -->
	<div class="card border border-surface-200-800 bg-surface-50-950 p-5">
		<div class="flex items-start gap-3">
			<IdCardIcon class="mt-0.5 size-5 shrink-0 text-primary-500" />
			<div>
				<h2 class="text-sm font-bold">Work Authorization &amp; Immigration</h2>
				<p class="mt-1 text-xs opacity-60">
					This information helps the job-application agent accurately answer eligibility questions,
					filter out roles that require sponsorship when you don't need it (or vice-versa), and
					include any necessary disclosures in cover letters.
				</p>
				<p class="mt-1 text-xs opacity-50">
					<strong>Note:</strong> This data stays on your device and is only used to fill out application
					forms — it is never shared with third parties directly.
				</p>
			</div>
		</div>
	</div>

	{#each workAuthFields as field (field.key)}
		{#if isVisible(field)}
			<ProfileFieldCard
				{field}
				value={getValue(field.key)}
				incomplete={isIncomplete(field.key)}
				layout="card"
				{oninput}
			/>
		{/if}
	{/each}
</div>
