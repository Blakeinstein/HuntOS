<script lang="ts">
	import { CodeIcon } from '@lucide/svelte';
	import type { FieldDef } from './profile.fields';
	import MarkdownEditorModal from '$lib/components/MarkdownEditorModal.svelte';

	interface Props {
		field: FieldDef;
		value: string;
		incomplete?: boolean;
		layout?: 'card' | 'inline';
		oninput: (key: string, value: string) => void;
	}

	let { field, value, incomplete = false, layout = 'card', oninput }: Props = $props();

	let mdOpen = $state(false);
	let modalValue = $state('');

	function openModal() {
		modalValue = value;
		mdOpen = true;
	}

	function handleModalClose() {
		mdOpen = false;
		if (modalValue !== value) {
			oninput(field.key, modalValue);
		}
	}
</script>

{#if layout === 'card'}
	<div class="card border border-surface-200-800 bg-surface-50-950 p-5">
		<label class="label">
			<span class="flex items-center justify-between gap-1.5">
				<span class="flex items-center gap-1.5 text-sm font-bold">
					<field.icon class="size-4 text-primary-500" />
					{field.label}
					{#if incomplete}
						<span class="badge preset-filled-warning-500 text-[10px]">Required</span>
					{/if}
				</span>
				{#if field.type === 'textarea'}
					<button
						type="button"
						class="btn gap-1.5 preset-tonal btn-sm"
						onclick={openModal}
						title="Open Markdown editor"
					>
						<CodeIcon class="size-3.5" />
						<span class="text-xs">MD</span>
					</button>
				{/if}
			</span>
			{#if field.hint}
				<p class="mt-0.5 text-xs opacity-50">{field.hint}</p>
			{/if}
			{#if field.type === 'textarea'}
				<textarea
					class="mt-2 textarea"
					class:border-warning-500={incomplete}
					rows="4"
					placeholder={field.placeholder ?? ''}
					{value}
					oninput={(e) => oninput(field.key, e.currentTarget.value)}
				></textarea>
			{:else if field.type === 'select' && field.options}
				<select
					class="select mt-2"
					class:border-warning-500={incomplete}
					{value}
					onchange={(e) => oninput(field.key, e.currentTarget.value)}
				>
					{#each field.options as opt (opt.value)}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
			{:else}
				<input
					type={field.type}
					class="mt-2 input"
					class:border-warning-500={incomplete}
					placeholder={field.placeholder ?? ''}
					{value}
					oninput={(e) => oninput(field.key, e.currentTarget.value)}
				/>
			{/if}
		</label>
	</div>
{:else}
	<label class="label">
		<span class="flex items-center justify-between gap-1.5">
			<span class="flex items-center gap-1.5 text-sm font-medium">
				<field.icon class="size-3.5 opacity-50" />
				{field.label}
				{#if incomplete}
					<span class="badge preset-filled-warning-500 text-[10px]">Required</span>
				{/if}
			</span>
			{#if field.type === 'textarea'}
				<button
					type="button"
					class="btn gap-1.5 preset-tonal btn-sm"
					onclick={openModal}
					title="Open Markdown editor"
				>
					<CodeIcon class="size-3.5" />
					<span class="text-xs">MD</span>
				</button>
			{/if}
		</span>
		{#if field.hint}
			<p class="mt-0.5 text-xs opacity-50">{field.hint}</p>
		{/if}
		<div class="relative mt-1">
			{#if field.type === 'textarea'}
				<textarea
					class="textarea"
					class:border-warning-500={incomplete}
					rows="3"
					placeholder={field.placeholder ?? ''}
					{value}
					oninput={(e) => oninput(field.key, e.currentTarget.value)}
				></textarea>
			{:else if field.type === 'select' && field.options}
				<select
					class="select"
					class:border-warning-500={incomplete}
					{value}
					onchange={(e) => oninput(field.key, e.currentTarget.value)}
				>
					{#each field.options as opt (opt.value)}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
			{:else}
				<input
					type={field.type}
					class="input"
					class:border-warning-500={incomplete}
					placeholder={field.placeholder ?? ''}
					{value}
					oninput={(e) => oninput(field.key, e.currentTarget.value)}
				/>
			{/if}
		</div>
	</label>
{/if}

{#if mdOpen}
	<MarkdownEditorModal
		bind:value={modalValue}
		title={field.label}
		icon={field.icon}
		placeholder={field.placeholder ?? ''}
		onClose={handleModalClose}
	/>
{/if}
