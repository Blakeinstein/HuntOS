<script lang="ts">
	import KanbanBoard from '$lib/components/KanbanBoard.svelte';

	let { data } = $props();

	const applications = $derived(data.applications ?? []);
	const swimlanes = $derived(data.swimlanes ?? []);
</script>

<KanbanBoard {applications} {swimlanes} />
