<!--
  CartaEditor.svelte
  Reusable Markdown editor component powered by Carta (https://github.com/BearToCode/carta).

  Features a custom Write / Preview tab bar. The Write tab shows Carta's
  MarkdownEditor (textarea with syntax highlighting). The Preview tab renders
  the markdown through Carta's Markdown viewer component.

  Usage:
    <CartaEditor bind:value={myContent} />
    <CartaEditor bind:value={myContent} placeholder="Write here..." />
    <CartaEditor bind:value={myContent} initialTab="preview" />
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { Carta, MarkdownEditor, Markdown } from 'carta-md';
	import 'carta-md/default.css';
	import type { Plugin } from 'carta-md';
	import { PencilIcon, EyeIcon } from '@lucide/svelte';

	interface Props {
		/** The markdown content (two-way bindable). */
		value: string;
		/** Placeholder shown when the editor is empty. */
		placeholder?: string;
		/** Hide Carta's built-in toolbar entirely. */
		disableToolbar?: boolean;
		/** Disable all default keyboard shortcuts. */
		disableShortcuts?: boolean;
		/** Disable all default toolbar icons. */
		disableIcons?: boolean;
		/** Additional Carta extensions/plugins to load. */
		extensions?: Plugin[];
		/** Custom HTML sanitizer. Defaults to passthrough (caller is responsible for trust). */
		sanitizer?: (html: string) => string;
		/** Which tab to show initially. Default: 'write'. */
		initialTab?: 'write' | 'preview';
		/** Extra CSS class(es) applied to the outermost wrapper div. */
		class?: string;
	}

	let {
		value = $bindable(''),
		placeholder = '',
		disableToolbar = false,
		disableShortcuts = false,
		disableIcons = false,
		extensions = [],
		sanitizer = (html: string) => html,
		initialTab = 'write',
		class: className = ''
	}: Props = $props();

	let activeTab = $state<'write' | 'preview'>(untrack(() => initialTab));

	// Carta is instantiated once at mount time — snapshot config props
	// outside of reactivity tracking to avoid Svelte 5 warnings.
	const carta = untrack(
		() =>
			new Carta({
				disableShortcuts: disableShortcuts === true ? true : undefined,
				disableIcons: disableIcons === true ? true : undefined,
				extensions,
				sanitizer
			})
	);
</script>

<div class="carta-editor-wrapper flex h-full w-full flex-col {className}">
	<!-- Custom tab bar -->
	<div class="flex shrink-0 items-center gap-0.5 border-b border-surface-200-800 px-3 py-1.5">
		<button
			type="button"
			class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors
				{activeTab === 'write'
				? 'text-surface-900-50 bg-surface-200-800'
				: 'text-surface-500 hover:text-surface-700-300'}"
			onclick={() => (activeTab = 'write')}
		>
			<PencilIcon class="size-3.5" />
			Write
		</button>
		<button
			type="button"
			class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors
				{activeTab === 'preview'
				? 'text-surface-900-50 bg-surface-200-800'
				: 'text-surface-500 hover:text-surface-700-300'}"
			onclick={() => (activeTab = 'preview')}
		>
			<EyeIcon class="size-3.5" />
			Preview
		</button>
	</div>

	<!-- Tab content -->
	<div class="min-h-0 flex-1 overflow-hidden">
		{#if activeTab === 'write'}
			<div class="carta-tab-write h-full">
				<MarkdownEditor
					{carta}
					bind:value
					mode="tabs"
					selectedTab="write"
					{placeholder}
					{disableToolbar}
				/>
			</div>
		{:else}
			<div class="carta-tab-preview h-full overflow-y-auto p-4">
				{#if value.trim()}
					{#key value}
						<div class="prose prose-sm max-w-none dark:prose-invert">
							<Markdown {carta} {value} />
						</div>
					{/key}
				{:else}
					<p class="text-sm italic opacity-40">Nothing to preview yet.</p>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	/* ── Monospace font (required by Carta) ─────────────────────── */
	:global(.carta-font-code) {
		font-family:
			ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
		font-size: 0.85rem;
		line-height: 1.5;
		letter-spacing: normal;
	}

	/* ── Write tab: fill parent, hide Carta's own tab bar ───────── */
	.carta-tab-write :global(.carta-editor) {
		height: 100%;
		border: none;
		border-radius: 0;
	}

	.carta-tab-write :global(.carta-wrapper) {
		height: 100%;
	}

	.carta-tab-write :global(.carta-container) {
		height: 100%;
	}

	.carta-tab-write :global(.carta-input-wrapper) {
		min-height: 100%;
	}

	/* Hide Carta's built-in tab bar — we manage tabs ourselves */
	.carta-tab-write :global(.carta-toolbar) {
		border-bottom: 1px solid rgba(128, 128, 128, 0.2);
		padding: 0.25rem 0.5rem;
	}

	.carta-tab-write :global(.carta-toolbar-left) {
		display: none;
	}

	/* Hide the renderer pane in the write tab (we only want the textarea) */
	.carta-tab-write :global(.carta-renderer) {
		display: none !important;
	}

	/* ── Preview tab ───────────────────────────────────────────── */
	.carta-tab-preview :global(.carta-renderer) {
		padding: 0;
	}

	/* ── Dark mode: Carta default theme ────────────────────────── */
	:global(.dark .carta-theme__default),
	:global([data-theme='dark'] .carta-theme__default) {
		--border-color: var(--border-color-dark, rgba(255, 255, 255, 0.1));
		--selection-color: var(--selection-color-dark, rgba(100, 100, 255, 0.3));
		--focus-outline: var(--focus-outline-dark, rgba(100, 100, 255, 0.5));
		--hover-color: var(--hover-color-dark, rgba(255, 255, 255, 0.05));
		--caret-color: var(--caret-color-dark, white);
		--text-color: var(--text-color-dark, rgba(255, 255, 255, 0.9));
	}

	/* ── Dark mode: Shiki syntax highlighting ──────────────────── */
	:global(.dark .shiki),
	:global(.dark .shiki span),
	:global([data-theme='dark'] .shiki),
	:global([data-theme='dark'] .shiki span) {
		color: var(--shiki-dark) !important;
	}
</style>
