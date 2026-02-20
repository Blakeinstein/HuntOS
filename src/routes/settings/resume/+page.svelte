<script lang="ts">
	import { FileTextIcon, ArrowLeftIcon, CheckIcon, TypeIcon, CodeIcon } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import { invalidate } from '$app/navigation';

	let { data } = $props();

	let resumeFormat = $derived(data.resumeFormat);
	let saving = $state(false);
	let saved = $state(false);
	let error = $state('');

	async function setFormat(format: 'markdown' | 'typst') {
		if (format === resumeFormat) return;

		saving = true;
		saved = false;
		error = '';

		// Optimistic update
		resumeFormat = format;

		try {
			const res = await fetch('/api/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ resume_format: format })
			});

			if (!res.ok) {
				const body = await res.json();
				throw new Error(body.error ?? 'Failed to update setting');
			}

			await invalidate('db:settings');
			saved = true;
			setTimeout(() => (saved = false), 2000);
		} catch (err) {
			// Roll back optimistic update
			await invalidate('db:settings');
			error = err instanceof Error ? err.message : 'Something went wrong';
		} finally {
			saving = false;
		}
	}
</script>

<div class="mx-auto max-w-3xl space-y-6">
	<!-- Header -->
	<div class="flex items-start gap-3">
		<a
			href={resolve('/settings')}
			class="mt-1 btn-icon btn-icon-sm preset-tonal"
			aria-label="Back to settings"
		>
			<ArrowLeftIcon class="size-4" />
		</a>
		<div>
			<h1 class="h3 font-bold">Resume Settings</h1>
			<p class="text-sm opacity-60">Choose how your resumes are generated and rendered.</p>
		</div>
	</div>

	<!-- Format picker -->
	<div class="space-y-3">
		<h2 class="text-sm font-bold tracking-wide uppercase opacity-60">Output Format</h2>

		<div class="grid gap-4 md:grid-cols-2">
			<!-- Markdown option -->
			<button
				class="relative flex flex-col items-start gap-3 card border p-5 text-left transition-all
					{resumeFormat === 'markdown'
					? 'border-primary-500 bg-primary-500/5 shadow-md'
					: 'border-surface-200-800 bg-surface-50-950 hover:border-primary-500/50 hover:shadow-sm'}"
				onclick={() => setFormat('markdown')}
				disabled={saving}
			>
				{#if resumeFormat === 'markdown'}
					<div
						class="absolute top-3 right-3 flex size-6 items-center justify-center rounded-full bg-primary-500 text-white"
					>
						<CheckIcon class="size-3.5" />
					</div>
				{/if}

				<div class="flex size-10 items-center justify-center rounded-lg bg-primary-500/10">
					<FileTextIcon class="size-5 text-primary-500" />
				</div>

				<div>
					<h3 class="font-bold">Markdown + Handlebars</h3>
					<p class="mt-1 text-xs opacity-60">
						Generates structured JSON from the LLM, renders through customisable Handlebars
						templates into Markdown, and converts to PDF via Chromium print.
					</p>
				</div>

				<div class="mt-auto flex flex-wrap gap-1.5">
					<span class="badge preset-outlined-surface-200-800 text-[10px]">Custom templates</span>
					<span class="badge preset-outlined-surface-200-800 text-[10px]">Markdown preview</span>
					<span class="badge preset-outlined-surface-200-800 text-[10px]">CSS styling</span>
				</div>
			</button>

			<!-- Typst option -->
			<button
				class="relative flex flex-col items-start gap-3 card border p-5 text-left transition-all
					{resumeFormat === 'typst'
					? 'border-secondary-500 bg-secondary-500/5 shadow-md'
					: 'border-surface-200-800 bg-surface-50-950 hover:border-secondary-500/50 hover:shadow-sm'}"
				onclick={() => setFormat('typst')}
				disabled={saving}
			>
				{#if resumeFormat === 'typst'}
					<div
						class="absolute top-3 right-3 flex size-6 items-center justify-center rounded-full bg-secondary-500 text-white"
					>
						<CheckIcon class="size-3.5" />
					</div>
				{/if}

				<div class="flex size-10 items-center justify-center rounded-lg bg-secondary-500/10">
					<TypeIcon class="size-5 text-secondary-500" />
				</div>

				<div>
					<h3 class="font-bold">Typst (NNJR Template)</h3>
					<p class="mt-1 text-xs opacity-60">
						Generates structured data from the LLM, serialises to YAML, and compiles natively
						through the NNJR Typst template. Produces pixel-perfect PDFs with guaranteed page-break
						control.
					</p>
				</div>

				<div class="mt-auto flex flex-wrap gap-1.5">
					<span class="badge preset-outlined-surface-200-800 text-[10px]">Native PDF</span>
					<span class="badge preset-outlined-surface-200-800 text-[10px]">Clean typography</span>
					<span class="badge preset-outlined-surface-200-800 text-[10px]">No browser needed</span>
				</div>
			</button>
		</div>
	</div>

	<!-- Status messages -->
	{#if saving}
		<div class="flex items-center gap-2 text-sm opacity-60">
			<div
				class="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
			></div>
			Saving…
		</div>
	{/if}

	{#if saved}
		<div class="flex items-center gap-2 text-sm text-success-600">
			<CheckIcon class="size-4" />
			Format updated to <strong>{resumeFormat}</strong>
		</div>
	{/if}

	{#if error}
		<div class="card border border-error-500/30 bg-error-500/5 p-3 text-sm text-error-600">
			{error}
		</div>
	{/if}

	<!-- Info panel -->
	<div class="space-y-3">
		<h2 class="text-sm font-bold tracking-wide uppercase opacity-60">How it works</h2>

		<div class="card border border-surface-200-800 bg-surface-50-950 p-5">
			{#if resumeFormat === 'markdown'}
				<div class="flex items-start gap-3">
					<CodeIcon class="mt-0.5 size-4 shrink-0 text-primary-500" />
					<div class="space-y-2 text-xs opacity-70">
						<p>
							<strong>Pipeline:</strong> Profile + Job Description → LLM (structured JSON) → Handlebars
							template → Markdown → Chromium PDF
						</p>
						<p>
							You can create and customise multiple Handlebars templates from the
							<a href={resolve('/resume')} class="text-primary-500 underline">Resume page</a>. Each
							template controls the layout, sections, and formatting of the output.
						</p>
						<p>
							The Markdown output is also saved to history and can be previewed directly in the app.
						</p>
					</div>
				</div>
			{:else}
				<div class="flex items-start gap-3">
					<CodeIcon class="mt-0.5 size-4 shrink-0 text-secondary-500" />
					<div class="space-y-2 text-xs opacity-70">
						<p>
							<strong>Pipeline:</strong> Profile + Job Description → LLM (structured JSON) → YAML → Typst
							compile → PDF
						</p>
						<p>
							Uses the
							<a
								href="https://github.com/tzx/NNJR"
								target="_blank"
								rel="noopener noreferrer"
								class="text-secondary-500 underline">NNJR</a
							>
							Typst template (included as a Git submodule). The template is fixed — it produces a clean,
							Jake's Resume-style layout with perfect page-break handling.
						</p>
						<p>
							Requires the
							<code class="rounded bg-surface-200-800 px-1.5 py-0.5 text-[10px]">typst</code>
							CLI to be installed on your system.
						</p>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
