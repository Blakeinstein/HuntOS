<script lang="ts">
	import { NotebookPenIcon } from '@lucide/svelte';
	import ProfileFieldCard from './ProfileFieldCard.svelte';
	import { applicationNotesField } from './profile.fields';

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
	<div class="card border border-surface-200-800 bg-surface-50-950 p-5">
		<div class="flex items-start gap-3">
			<NotebookPenIcon class="mt-0.5 size-5 shrink-0 text-primary-500" />
			<div>
				<h2 class="text-sm font-bold">Application Notes</h2>
				<p class="mt-1 text-xs opacity-60">
					Free-form notes that the agent will reference when preparing and submitting applications
					on your behalf. Use this to communicate anything not captured elsewhere — talking points
					to emphasise, achievements to highlight, things to avoid, or special instructions.
				</p>
			</div>
		</div>
	</div>

	<ProfileFieldCard
		field={applicationNotesField}
		value={getValue(applicationNotesField.key)}
		incomplete={isIncomplete(applicationNotesField.key)}
		layout="card"
		{oninput}
	/>
</div>
