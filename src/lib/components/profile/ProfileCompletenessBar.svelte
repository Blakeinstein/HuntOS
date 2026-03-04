<script lang="ts">
	import { AlertCircleIcon, CheckCircleIcon } from '@lucide/svelte';

	interface Props {
		completeness: number;
		incompleteFields: string[];
	}

	let { completeness, incompleteFields }: Props = $props();

	function getCompletenessColor(): string {
		if (completeness >= 80) return 'bg-success-500';
		if (completeness >= 50) return 'bg-warning-500';
		return 'bg-error-500';
	}
</script>

<div class="card border border-surface-200-800 bg-surface-50-950 p-5">
	<div class="flex items-center justify-between">
		<div>
			<h2 class="text-sm font-bold">Profile Completeness</h2>
			{#if incompleteFields.length > 0}
				<p class="mt-0.5 flex items-center gap-1.5 text-xs opacity-60">
					<AlertCircleIcon class="size-3 text-warning-500" />
					Missing: {incompleteFields.join(', ')}
				</p>
			{:else}
				<p class="mt-0.5 flex items-center gap-1.5 text-xs text-success-500">
					<CheckCircleIcon class="size-3" />
					All required fields are filled
				</p>
			{/if}
		</div>
		<div class="text-right">
			<span class="text-2xl font-bold">{completeness}%</span>
		</div>
	</div>
	<div class="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-200-800">
		<div
			class="h-full rounded-full transition-all duration-500 {getCompletenessColor()}"
			style="width: {completeness}%"
		></div>
	</div>
</div>
