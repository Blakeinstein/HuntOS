<!--
  TemplateEditorModal.svelte
  Full-screen modal for viewing and editing resume Handlebars templates.
  Uses the reusable CartaEditor component for the markdown editing experience.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import {
		XIcon,
		CheckCircleIcon,
		LoaderCircleIcon,
		RotateCcwIcon,
		MaximizeIcon,
		MinimizeIcon
	} from '@lucide/svelte';
	import CartaEditor from '$lib/components/CartaEditor.svelte';

	interface TemplateData {
		id: number;
		name: string;
		content: string;
		is_default: number;
	}

	interface Props {
		template: TemplateData;
		onSave: (id: number, name: string, content: string) => Promise<void>;
		onClose: () => void;
	}

	let { template, onSave, onClose }: Props = $props();

	// Snapshot the initial values outside of reactivity tracking so Svelte 5
	// doesn't warn about capturing a prop value into a local variable.
	const initialName = untrack(() => template.name);
	const initialContent = untrack(() => template.content);

	let name = $state(initialName);
	let content = $state(initialContent);
	let saving = $state(false);
	let error = $state('');
	let isFullscreen = $state(false);

	const isDirty = $derived(name !== initialName || content !== initialContent);

	async function handleSave() {
		if (saving || !isDirty) return;
		saving = true;
		error = '';

		try {
			await onSave(template.id, name, content);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to save template';
		} finally {
			saving = false;
		}
	}

	function handleReset() {
		name = initialName;
		content = initialContent;
		error = '';
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (isFullscreen) {
				isFullscreen = false;
			} else {
				onClose();
			}
		}
		if ((e.metaKey || e.ctrlKey) && e.key === 's') {
			e.preventDefault();
			handleSave();
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/60 backdrop-blur-sm"
	onkeydown={handleKeydown}
>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="flex flex-col card border border-surface-200-800 bg-surface-50-950 shadow-xl transition-all duration-200
			{isFullscreen ? 'h-full w-full rounded-none' : 'mx-4 h-[85vh] w-full max-w-4xl rounded-xl'}"
		onclick={(e) => e.stopPropagation()}
	>
		<!-- Header -->
		<header
			class="flex shrink-0 items-center justify-between border-b border-surface-200-800 px-5 py-3"
		>
			<div class="flex min-w-0 flex-1 items-center gap-3">
				{#if template.is_default}
					<h2 class="truncate text-sm font-bold">{template.name}</h2>
					<span class="badge shrink-0 preset-filled-primary-500 text-[10px]">Default</span>
				{:else}
					<input
						type="text"
						class="input max-w-xs text-sm font-bold"
						placeholder="Template name"
						bind:value={name}
					/>
				{/if}
			</div>

			<div class="flex shrink-0 items-center gap-1.5">
				{#if isDirty}
					<button
						type="button"
						class="btn gap-1.5 preset-tonal btn-sm"
						title="Revert changes"
						onclick={handleReset}
					>
						<RotateCcwIcon class="size-3.5" />
						<span class="hidden sm:inline">Revert</span>
					</button>
				{/if}

				<button
					type="button"
					class="btn gap-1.5 preset-filled-primary-500 btn-sm"
					disabled={saving || !isDirty}
					onclick={handleSave}
					title="Save (Ctrl+S)"
				>
					{#if saving}
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
					onclick={onClose}
					aria-label="Close editor"
				>
					<XIcon class="size-4" />
				</button>
			</div>
		</header>

		<!-- Error banner -->
		{#if error}
			<div class="shrink-0 border-b border-error-500/30 bg-error-500/10 px-5 py-2">
				<p class="text-sm text-error-500">{error}</p>
			</div>
		{/if}

		<!-- Editor body -->
		<div class="min-h-0 flex-1 overflow-hidden">
			<CartaEditor
				bind:value={content}
				placeholder="Write your Handlebars template here..."
				disableShortcuts
				disableIcons
			/>
		</div>

		<!-- Footer with Handlebars variable reference -->
		<footer class="shrink-0 border-t border-surface-200-800 px-5 py-2">
			<p class="text-[11px] leading-relaxed opacity-50">
				<strong>Handlebars variables:</strong>
				<code class="text-[10px]">{'{{name}}'}</code>,
				<code class="text-[10px]">{'{{professional_profile}}'}</code>,
				<code class="text-[10px]">{'{{#each skills}}'}</code>,
				<code class="text-[10px]">{'{{#each experience}}'}</code>
				(<code class="text-[10px]">job_title</code>, <code class="text-[10px]">company</code>,
				<code class="text-[10px]">achievements</code>),
				<code class="text-[10px]">{'{{#each education}}'}</code>,
				<code class="text-[10px]">{'{{#each certifications}}'}</code>,
				<code class="text-[10px]">{'{{#each projects}}'}</code>,
				<code class="text-[10px]">{'{{additional_info}}'}</code>
				&bull; <kbd class="text-[10px]">Ctrl+S</kbd> to save &bull;
				<kbd class="text-[10px]">Esc</kbd> to close
			</p>
		</footer>
	</div>
</div>
