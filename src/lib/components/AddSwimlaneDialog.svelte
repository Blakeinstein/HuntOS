<script lang="ts">
	import { PlusIcon, XIcon } from '@lucide/svelte';

	interface Props {
		onSubmit: (name: string) => void;
		onClose: () => void;
	}

	let { onSubmit, onClose }: Props = $props();

	let name = $state('');
	let error = $state('');

	function handleSubmit() {
		const trimmed = name.trim();
		if (!trimmed) {
			error = 'Swimlane name is required.';
			return;
		}
		error = '';
		onSubmit(trimmed);
	}
</script>

<!-- Backdrop -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/60 backdrop-blur-sm"
	onkeydown={(e) => {
		if (e.key === 'Escape') onClose();
	}}
>
	<!-- Dialog panel -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="w-full max-w-md card border border-surface-200-800 bg-surface-50-950 p-6 shadow-xl"
		onclick={(e) => e.stopPropagation()}
	>
		<header class="mb-4 flex items-center justify-between">
			<h2 class="h4 font-bold">Add Swimlane</h2>
			<button
				type="button"
				class="btn-icon btn-icon-sm hover:preset-tonal"
				onclick={onClose}
				aria-label="Close dialog"
			>
				<XIcon class="size-4" />
			</button>
		</header>

		<form
			onsubmit={(e) => {
				e.preventDefault();
				handleSubmit();
			}}
			class="space-y-4"
		>
			<label class="label">
				<span class="text-sm font-medium">Swimlane Name</span>
				<input
					type="text"
					class="mt-1 input"
					placeholder="e.g. Interview, Offer, Phone Screen"
					bind:value={name}
					autofocus
				/>
				{#if error}
					<p class="mt-1 text-xs text-error-500">{error}</p>
				{/if}
			</label>

			<div class="flex justify-end gap-2">
				<button type="button" class="btn preset-tonal" onclick={onClose}> Cancel </button>
				<button type="submit" class="btn gap-1.5 preset-filled-primary-500">
					<PlusIcon class="size-4" />
					<span>Add</span>
				</button>
			</div>
		</form>
	</div>
</div>
