<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { BriefcaseIcon } from '@lucide/svelte';

	onMount(() => {
		goto('/applications', { replaceState: true });
	});
</script>

<div class="flex h-full items-center justify-center">
	<div class="flex flex-col items-center gap-4 text-center">
		<BriefcaseIcon class="size-12 animate-pulse text-primary-500" />
		<p class="text-sm opacity-50">Loading AutoApply...</p>
	</div>
</div>
