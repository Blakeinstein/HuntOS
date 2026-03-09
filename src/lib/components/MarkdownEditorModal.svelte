<!--
  MarkdownEditorModal.svelte
  Generic floating Markdown editor modal.

  Opens as a centred overlay with a backdrop. Supports fullscreen toggle and
  Escape to close. Content is kept in sync with the parent via a bindable
  `value` prop — no explicit save step is required.

  Usage:
    <MarkdownEditorModal
      bind:value={myText}
      title="My Field"
      placeholder="Write here…"
      onClose={() => (open = false)}
    />
-->
<script lang="ts">
	import type { Component } from 'svelte';
	import { XIcon, MaximizeIcon, MinimizeIcon } from '@lucide/svelte';
	import CartaEditor from '$lib/components/CartaEditor.svelte';

	interface Props {
		/** The markdown content — two-way bindable, kept in sync with parent. */
		value: string;
		/** Modal header title. */
		title: string;
		/** Icon component to show beside the title (optional). */
		icon?: Component<{ class?: string }>;
		/** Placeholder shown in the editor when empty. */
		placeholder?: string;
		/** Called when the user closes the modal. */
		onClose: () => void;
	}

	let {
		value = $bindable(''),
		title,
		icon: IconComponent,
		placeholder = '',
		onClose
	}: Props = $props();

	let isFullscreen = $state(false);

	const wordCount = $derived(value.trim().length > 0 ? value.trim().split(/\s+/).length : 0);

	function handleBackdropKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (isFullscreen) {
				isFullscreen = false;
			} else {
				onClose();
			}
		}
	}

	function handleBackdropClick() {
		if (!isFullscreen) onClose();
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/60 backdrop-blur-sm"
	onclick={handleBackdropClick}
	onkeydown={handleBackdropKeydown}
>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="flex flex-col card border border-surface-200-800 bg-surface-50-950 shadow-xl transition-all duration-200
			{isFullscreen ? 'h-full w-full rounded-none' : 'mx-4 h-[80vh] w-full max-w-4xl rounded-xl'}"
		onclick={(e) => e.stopPropagation()}
	>
		<!-- Header -->
		<header
			class="flex shrink-0 items-center justify-between border-b border-surface-200-800 px-5 py-3"
		>
			<div class="flex items-center gap-2">
				{#if IconComponent}
					<IconComponent class="size-4 text-primary-500" />
				{/if}
				<h2 class="text-sm font-bold">{title}</h2>
				{#if wordCount > 0}
					<span class="text-xs opacity-50">{wordCount} words</span>
				{/if}
			</div>

			<div class="flex items-center gap-1.5">
				<button
					type="button"
					class="btn-icon btn-icon-sm hover:preset-tonal"
					onclick={() => (isFullscreen = !isFullscreen)}
					title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
				>
					{#if isFullscreen}
						<MinimizeIcon class="size-4" />
					{:else}
						<MaximizeIcon class="size-4" />
					{/if}
				</button>

				<button
					type="button"
					class="btn-icon btn-icon-sm hover:preset-tonal"
					onclick={onClose}
					aria-label="Close editor"
				>
					<XIcon class="size-4" />
				</button>
			</div>
		</header>

		<!-- Editor body -->
		<div class="jd-editor-body min-h-0 flex-1 overflow-hidden">
			<CartaEditor bind:value {placeholder} disableToolbar />
		</div>

		<!-- Footer hint -->
		<footer class="shrink-0 border-t border-surface-200-800 px-5 py-2">
			<p class="text-[11px] opacity-40">
				Changes are saved automatically &bull;
				<kbd class="text-[10px]">Esc</kbd> to close
			</p>
		</footer>
	</div>
</div>

<style>
	.jd-editor-body :global(.carta-input) {
		font-size: 0.8125rem;
		line-height: 1.6;
	}

	.jd-editor-body :global(.carta-font-code) {
		font-size: 0.8125rem;
		line-height: 1.6;
	}
</style>
