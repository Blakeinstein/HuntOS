<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	onMount(() => {
		goto('/applications', { replaceState: true });
	});
</script>

<div class="flex h-full items-center justify-center">
	<div class="flex flex-col items-center gap-4 text-center">
		<img src="/favicon-96x96.png" alt="HuntOS" class="size-12 animate-pulse" />
		<p class="text-sm opacity-50">Loading HuntOS...</p>
	</div>
</div>
