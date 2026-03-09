<!--
  SummaryEditorModal.svelte
  Floating editor modal for viewing and correcting AI-generated link summaries.

  Opens in Write mode so the user can immediately edit. Tracks dirty state and
  exposes Save (calls onSave) and Revert buttons. Fullscreen toggle and Escape
  to close are supported — Escape prompts if there are unsaved changes.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import {
		XIcon,
		MaximizeIcon,
		MinimizeIcon,
		CheckCircleIcon,
		RotateCcwIcon,
		LoaderCircleIcon,
		SparklesIcon,
		ClockIcon
	} from '@lucide/svelte';
	import CartaEditor from '$lib/components/CartaEditor.svelte';

	interface Props {
		/** The link title — used as the modal heading. */
		title: string;
		/** The current summary text to edit. */
		summary: string;
		/** ISO timestamp of when the summary was generated, for display. */
		generatedAt?: string | null;
		/** Called with the new summary text when the user clicks Save. */
		onSave: (newSummary: string) => Promise<void>;
		/** Called when the modal should close. */
		onClose: () => void;
	}

	let { title, summary, generatedAt = null, onSave, onClose }: Props = $props();

	const initial = untrack(() => summary);

	let localValue = $state(initial);
	let isFullscreen = $state(false);
	let isSaving = $state(false);
	let saveError = $state('');

	const isDirty = $derived(localValue !== initial);
	const wordCount = $derived(
		localValue.trim().length > 0 ? localValue.trim().split(/\s+/).length : 0
	);

	function formatRelativeTime(isoDate: string | null): string {
		if (!isoDate) return '';
		const date = new Date(isoDate);
		const diffMs = Date.now() - date.getTime();
		const diffSec = Math.floor(diffMs / 1000);
		if (diffSec < 60) return 'just now';
		const diffMin = Math.floor(diffSec / 60);
		if (diffMin < 60) return `${diffMin}m ago`;
		const diffHr = Math.floor(diffMin / 60);
		if (diffHr < 24) return `${diffHr}h ago`;
		return `${Math.floor(diffHr / 24)}d ago`;
	}

	async function handleSave() {
		if (!isDirty || isSaving) return;
		isSaving = true;
		saveError = '';
		try {
			await onSave(localValue);
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Failed to save';
		} finally {
			isSaving = false;
		}
	}

	function handleRevert() {
		localValue = initial;
		saveError = '';
	}

	function handleBackdropClick() {
		if (!isFullscreen) tryClose();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (isFullscreen) {
				isFullscreen = false;
				return;
			}
			tryClose();
		}
		if ((e.metaKey || e.ctrlKey) && e.key === 's') {
			e.preventDefault();
			handleSave();
		}
	}

	function tryClose() {
		if (isDirty) {
			// eslint-disable-next-line no-alert
			if (!window.confirm('You have unsaved changes. Close without saving?')) return;
		}
		onClose();
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/60 backdrop-blur-sm"
	onclick={handleBackdropClick}
	onkeydown={handleKeydown}
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
			<div class="flex min-w-0 items-center gap-2">
				<SparklesIcon class="size-4 shrink-0 text-primary-500" />
				<h2 class="truncate text-sm font-bold">{title} — AI Summary</h2>
				<span class="shrink-0 text-xs opacity-50">{wordCount} words</span>
				{#if generatedAt}
					<span class="flex shrink-0 items-center gap-1 text-[10px] opacity-40">
						<ClockIcon class="size-3" />
						{formatRelativeTime(generatedAt)}
					</span>
				{/if}
			</div>

			<div class="flex shrink-0 items-center gap-1.5">
				{#if isDirty}
					<button
						type="button"
						class="btn gap-1.5 preset-tonal btn-sm"
						onclick={handleRevert}
						title="Revert to original"
					>
						<RotateCcwIcon class="size-3.5" />
						<span class="hidden sm:inline">Revert</span>
					</button>
				{/if}

				<button
					type="button"
					class="btn gap-1.5 preset-filled-primary-500 btn-sm"
					disabled={!isDirty || isSaving}
					onclick={handleSave}
					title="Save changes (Ctrl+S)"
				>
					{#if isSaving}
						<LoaderCircleIcon class="size-3.5 animate-spin" />
					{:else}
						<CheckCircleIcon class="size-3.5" />
					{/if}
					<span class="hidden sm:inline">Save</span>
				</button>

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
					onclick={tryClose}
					aria-label="Close editor"
				>
					<XIcon class="size-4" />
				</button>
			</div>
		</header>

		<!-- Error banner -->
		{#if saveError}
			<div class="shrink-0 border-b border-error-500/30 bg-error-500/10 px-5 py-2">
				<p class="text-sm text-error-500">{saveError}</p>
			</div>
		{/if}

		<!-- Editor body -->
		<div class="summary-editor-body min-h-0 flex-1 overflow-hidden">
			<CartaEditor bind:value={localValue} disableToolbar />
		</div>

		<!-- Footer -->
		<footer class="shrink-0 border-t border-surface-200-800 px-5 py-2">
			<p class="text-[11px] opacity-40">
				{#if isDirty}
					<span class="text-warning-500">Unsaved changes</span> &bull;
				{/if}
				<kbd class="text-[10px]">Ctrl+S</kbd> to save &bull;
				<kbd class="text-[10px]">Esc</kbd> to close
			</p>
		</footer>
	</div>
</div>

<style>
	.summary-editor-body :global(.carta-input) {
		font-size: 0.8125rem;
		line-height: 1.6;
	}

	.summary-editor-body :global(.carta-font-code) {
		font-size: 0.8125rem;
		line-height: 1.6;
	}
</style>
