<script lang="ts">
	import { invalidate } from '$app/navigation';
	import {
		FileTextIcon,
		SparklesIcon,
		AlertTriangleIcon,
		CheckCircleIcon,
		LoaderCircleIcon,
		CopyIcon,
		LayoutTemplateIcon,
		PlusIcon,
		EyeIcon,
		Trash2Icon,
		RotateCcwIcon,
		XIcon,
		MessageSquareIcon
	} from '@lucide/svelte';
	import { Tabs } from '@skeletonlabs/skeleton-svelte';
	import ResumeChat from '$lib/components/ResumeChat.svelte';
	import TemplateEditorModal from '$lib/components/TemplateEditorModal.svelte';

	let { data } = $props();

	// ── Generate tab state ───────────────────────────────────────
	let jobDescription = $state('');
	let generatedMarkdown = $state('');
	let generatedData = $state<Record<string, unknown> | null>(null);
	let selectedTemplateId = $state<number | null>(null);
	let isGenerating = $state(false);
	let error = $state('');
	let success = $state(false);
	let copied = $state(false);

	// ── Templates tab state ──────────────────────────────────────
	let activeTab = $state('chat');
	let modalTemplate = $state<{
		id: number;
		name: string;
		content: string;
		is_default: number;
	} | null>(null);
	let isAddingTemplate = $state(false);
	let newTemplateName = $state('');
	let newTemplateContent = $state('');
	let templateError = $state('');
	let templateSaving = $state(false);

	const templates = $derived(data.templates ?? []);

	const effectiveTemplateId = $derived(
		selectedTemplateId ?? (templates.length > 0 ? templates[0].id : null)
	);

	const canGenerate = $derived(
		jobDescription.trim().length > 0 && !isGenerating && data.hasProfile
	);

	// ── Generate ─────────────────────────────────────────────────

	async function generateResume() {
		if (!canGenerate) return;

		isGenerating = true;
		error = '';
		success = false;
		generatedMarkdown = '';
		generatedData = null;

		try {
			const body: Record<string, unknown> = {
				jobDescription: jobDescription.trim()
			};
			if (effectiveTemplateId) {
				body.templateId = effectiveTemplateId;
			}

			const response = await fetch('/api/resumes/generate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			const result = await response.json();

			if (!response.ok) {
				throw new Error(result.error || `Request failed with status ${response.status}`);
			}

			generatedMarkdown = result.markdown ?? '';
			generatedData = result.data ?? null;
			success = true;
		} catch (err) {
			error = err instanceof Error ? err.message : 'An unexpected error occurred';
		} finally {
			isGenerating = false;
		}
	}

	async function copyMarkdown() {
		if (!generatedMarkdown) return;
		try {
			await navigator.clipboard.writeText(generatedMarkdown);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// clipboard API not available
		}
	}

	// ── Template CRUD helpers ────────────────────────────────────

	async function createTemplate() {
		if (!newTemplateName.trim() || !newTemplateContent.trim()) return;
		templateSaving = true;
		templateError = '';

		try {
			const res = await fetch('/api/resumes/templates', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: newTemplateName.trim(), content: newTemplateContent })
			});
			const result = await res.json();
			if (!res.ok) throw new Error(result.error);

			newTemplateName = '';
			newTemplateContent = '';
			isAddingTemplate = false;
			await invalidate('db:resume-templates');
		} catch (err) {
			templateError = err instanceof Error ? err.message : 'Failed to create template';
		} finally {
			templateSaving = false;
		}
	}

	async function saveTemplateFromModal(id: number, name: string, content: string) {
		templateError = '';

		const res = await fetch('/api/resumes/templates', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id, name, content })
		});
		const result = await res.json();
		if (!res.ok) throw new Error(result.error);

		modalTemplate = null;
		await invalidate('db:resume-templates');
	}

	async function deleteTemplate(id: number) {
		templateError = '';
		try {
			const res = await fetch('/api/resumes/templates', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id })
			});
			const result = await res.json();
			if (!res.ok) throw new Error(result.error);

			if (selectedTemplateId === id) selectedTemplateId = null;
			await invalidate('db:resume-templates');
		} catch (err) {
			templateError = err instanceof Error ? err.message : 'Failed to delete template';
		}
	}

	async function resetDefault() {
		templateError = '';
		try {
			const defaultTpl = templates.find((t: { is_default: number }) => t.is_default);
			if (!defaultTpl) return;

			const res = await fetch('/api/resumes/templates', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: defaultTpl.id, reset: true })
			});
			const result = await res.json();
			if (!res.ok) throw new Error(result.error);

			await invalidate('db:resume-templates');
		} catch (err) {
			templateError = err instanceof Error ? err.message : 'Failed to reset template';
		}
	}
</script>

<div class="mx-auto max-w-5xl space-y-6">
	<!-- Page Header -->
	<div>
		<h1 class="h3 font-bold">Resume Generator</h1>
		<p class="text-sm opacity-60">
			Generate a tailored, ATS-friendly resume from your profile for any job description.
		</p>
	</div>

	<!-- Profile status -->
	{#if !data.hasProfile}
		<div class="card border border-warning-500/30 bg-warning-500/10 p-4">
			<div class="flex items-center gap-3">
				<AlertTriangleIcon class="size-5 text-warning-500" />
				<div>
					<p class="text-sm font-bold">Profile Incomplete</p>
					<p class="text-xs opacity-60">
						Please fill out your <a href="/profiles" class="text-primary-500 underline">profile</a>
						first (at least 20% complete).
					</p>
				</div>
			</div>
		</div>
	{/if}

	<!-- Tabs: AI Chat | Generate | Templates -->
	<Tabs value={activeTab} onValueChange={(details) => (activeTab = details.value ?? 'chat')}>
		<Tabs.List>
			<Tabs.Trigger value="chat">
				<MessageSquareIcon class="mr-1.5 size-4" />
				AI Writer
			</Tabs.Trigger>
			<Tabs.Trigger value="generate">
				<SparklesIcon class="mr-1.5 size-4" />
				Quick Generate
			</Tabs.Trigger>
			<Tabs.Trigger value="templates">
				<LayoutTemplateIcon class="mr-1.5 size-4" />
				Templates
				{#if templates.length > 0}
					<span
						class="ml-1 rounded-full bg-primary-500/20 px-1.5 py-0.5 text-[10px] font-bold text-primary-500"
					>
						{templates.length}
					</span>
				{/if}
			</Tabs.Trigger>
			<Tabs.Indicator />
		</Tabs.List>

		<!-- ═══ AI Chat Tab ═══ -->
		<Tabs.Content value="chat">
			<div class="mt-4">
				<ResumeChat />
			</div>
		</Tabs.Content>

		<!-- ═══ Generate Tab ═══ -->
		<Tabs.Content value="generate">
			<div class="mt-4 grid gap-6 lg:grid-cols-2">
				<!-- Left: Job Description Input -->
				<div class="space-y-4 card border border-surface-200-800 bg-surface-50-950 p-5">
					<h2 class="flex items-center gap-2 text-sm font-bold">
						<FileTextIcon class="size-4 text-primary-500" />
						Job Description
					</h2>

					<textarea
						class="textarea min-h-75 font-mono text-sm"
						placeholder="Paste the full job description here...

Example:
We are looking for a Senior Software Engineer with 5+ years of experience in TypeScript, React, and Node.js. The ideal candidate will have experience with distributed systems..."
						bind:value={jobDescription}
						disabled={isGenerating}
					></textarea>

					<!-- Template picker -->
					{#if templates.length > 1}
						<label class="label">
							<span class="text-xs font-medium opacity-60">Template</span>
							<select
								class="select text-sm"
								bind:value={selectedTemplateId}
								disabled={isGenerating}
							>
								{#each templates as tpl (tpl.id)}
									<option value={tpl.id}>
										{tpl.name}{tpl.is_default ? ' (default)' : ''}
									</option>
								{/each}
							</select>
						</label>
					{/if}

					<div class="flex items-center justify-between">
						<span class="text-xs opacity-50">
							{jobDescription.trim().length > 0
								? `${jobDescription.trim().split(/\s+/).length} words`
								: 'No content yet'}
						</span>

						<button
							type="button"
							class="btn gap-2 preset-filled-primary-500"
							disabled={!canGenerate}
							onclick={generateResume}
						>
							{#if isGenerating}
								<LoaderCircleIcon class="size-4 animate-spin" />
								<span>Generating…</span>
							{:else}
								<SparklesIcon class="size-4" />
								<span>Generate Resume</span>
							{/if}
						</button>
					</div>

					{#if error}
						<div class="card border border-error-500/30 bg-error-500/10 p-3">
							<p class="flex items-center gap-2 text-sm text-error-500">
								<AlertTriangleIcon class="size-4 shrink-0" />
								{error}
							</p>
						</div>
					{/if}
				</div>

				<!-- Right: Generated Resume Preview -->
				<div class="space-y-4 card border border-surface-200-800 bg-surface-50-950 p-5">
					<div class="flex items-center justify-between">
						<h2 class="flex items-center gap-2 text-sm font-bold">
							<SparklesIcon class="size-4 text-primary-500" />
							Generated Resume
						</h2>

						{#if generatedMarkdown}
							<button type="button" class="btn gap-1.5 preset-tonal btn-sm" onclick={copyMarkdown}>
								{#if copied}
									<CheckCircleIcon class="size-3.5" />
									<span>Copied!</span>
								{:else}
									<CopyIcon class="size-3.5" />
									<span>Copy</span>
								{/if}
							</button>
						{/if}
					</div>

					{#if isGenerating}
						<div class="flex flex-col items-center justify-center gap-3 py-16 opacity-60">
							<LoaderCircleIcon class="size-8 animate-spin text-primary-500" />
							<p class="text-sm">Generating your tailored resume…</p>
							<p class="text-xs opacity-50">This may take a minute or two depending on the LLM.</p>
						</div>
					{:else if generatedMarkdown}
						<div
							class="max-h-125 overflow-y-auto rounded border border-surface-200-800 bg-surface-100-900 p-4"
						>
							<pre
								class="font-mono text-xs leading-relaxed whitespace-pre-wrap">{generatedMarkdown}</pre>
						</div>

						{#if success && generatedData}
							<p class="flex items-center gap-1.5 text-xs text-success-500">
								<CheckCircleIcon class="size-3.5" />
								Resume generated successfully — {(generatedData.skills as string[])?.length ?? 0} skills,
								{(generatedData.experience as unknown[])?.length ?? 0} experience entries
							</p>
						{/if}
					{:else}
						<div class="flex flex-col items-center justify-center gap-2 py-16 opacity-40">
							<FileTextIcon class="size-10" />
							<p class="text-sm">Your generated resume will appear here</p>
							<p class="text-xs">Paste a job description and click Generate</p>
						</div>
					{/if}
				</div>
			</div>
		</Tabs.Content>

		<!-- ═══ Templates Tab ═══ -->
		<Tabs.Content value="templates">
			<div class="mt-4 space-y-4">
				{#if templateError}
					<div class="card border border-error-500/30 bg-error-500/10 p-3">
						<p class="flex items-center gap-2 text-sm text-error-500">
							<AlertTriangleIcon class="size-4 shrink-0" />
							{templateError}
						</p>
					</div>
				{/if}

				<!-- Template list -->
				{#each templates as tpl (tpl.id)}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="group cursor-pointer card border border-surface-200-800 bg-surface-50-950 p-5 transition-colors hover:border-primary-500/40 hover:bg-primary-500/5"
						onclick={() =>
							(modalTemplate = {
								id: tpl.id,
								name: tpl.name,
								content: tpl.content,
								is_default: tpl.is_default
							})}
					>
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0 flex-1">
								<h3 class="text-sm font-bold">
									{tpl.name}
									{#if tpl.is_default}
										<span class="ml-1.5 badge preset-filled-primary-500 text-[10px]">Default</span>
									{/if}
								</h3>
								<p class="mt-0.5 text-xs opacity-50">
									Updated {new Date(tpl.updated_at).toLocaleDateString()}
								</p>
							</div>
							<div class="flex shrink-0 items-center gap-1.5">
								<span
									class="flex items-center gap-1 text-xs opacity-0 transition-opacity group-hover:opacity-60"
								>
									<EyeIcon class="size-3.5" />
									Click to open
								</span>
								{#if tpl.is_default}
									<button
										type="button"
										class="btn-icon btn-icon-sm hover:preset-tonal"
										title="Reset to built-in default"
										onclick={(e) => {
											e.stopPropagation();
											resetDefault();
										}}
									>
										<RotateCcwIcon class="size-3.5" />
									</button>
								{:else}
									<button
										type="button"
										class="btn-icon btn-icon-sm hover:preset-tonal-error"
										title="Delete"
										onclick={(e) => {
											e.stopPropagation();
											deleteTemplate(tpl.id);
										}}
									>
										<Trash2Icon class="size-3.5" />
									</button>
								{/if}
							</div>
						</div>

						<!-- Content preview -->
						<div
							class="mt-3 max-h-24 overflow-hidden rounded border border-surface-200-800 bg-surface-100-900 p-3"
						>
							<pre
								class="font-mono text-[11px] leading-relaxed whitespace-pre-wrap opacity-60">{tpl.content}</pre>
						</div>
					</div>
				{/each}

				<!-- Add new template -->
				{#if isAddingTemplate}
					<div class="space-y-3 card border border-primary-500/30 bg-primary-500/5 p-5">
						<h3 class="text-sm font-bold">New Template</h3>
						<input
							type="text"
							class="input text-sm"
							placeholder="Template name (e.g. 'Minimal', 'Academic')"
							bind:value={newTemplateName}
						/>
						<textarea
							class="textarea min-h-50 font-mono text-xs"
							placeholder={'Handlebars template content...\n\nUse variables like {{name}}, {{professional_profile}}, {{#each skills}}, {{#each experience}}, etc.'}
							bind:value={newTemplateContent}
						></textarea>
						<div class="flex justify-end gap-2">
							<button
								type="button"
								class="btn gap-1.5 preset-tonal btn-sm"
								onclick={() => {
									isAddingTemplate = false;
									newTemplateName = '';
									newTemplateContent = '';
								}}
							>
								<XIcon class="size-3.5" />
								Cancel
							</button>
							<button
								type="button"
								class="btn gap-1.5 preset-filled-primary-500 btn-sm"
								disabled={templateSaving || !newTemplateName.trim() || !newTemplateContent.trim()}
								onclick={createTemplate}
							>
								{#if templateSaving}
									<LoaderCircleIcon class="size-3.5 animate-spin" />
								{:else}
									<CheckCircleIcon class="size-3.5" />
								{/if}
								Create
							</button>
						</div>
					</div>
				{:else}
					<button
						type="button"
						class="btn w-full gap-2 preset-tonal"
						onclick={() => (isAddingTemplate = true)}
					>
						<PlusIcon class="size-4" />
						Add Custom Template
					</button>
				{/if}

				<!-- Help text -->
				<div class="rounded border border-surface-200-800 bg-surface-100-900 p-4">
					<h4 class="text-xs font-bold opacity-70">Template Variables</h4>
					<p class="mt-1 text-[11px] leading-relaxed opacity-50">
						Templates use <strong>Handlebars</strong> syntax. Available variables:
						<code>name</code>, <code>professional_profile</code>,
						<code>skills</code> (array), <code>experience</code> (array with
						<code>job_title</code>, <code>company</code>, <code>location</code>,
						<code>start_date</code>, <code>end_date</code>, <code>achievements</code>),
						<code>education</code> (array with <code>degree</code>,
						<code>institution</code>, <code>location</code>,
						<code>graduation_date</code>), <code>certifications</code> (array with
						<code>name</code>, <code>issuer</code>, <code>date</code>),
						<code>projects</code> (array with <code>name</code>,
						<code>description</code>, <code>technologies</code>),
						<code>additional_info</code> (key-value object).
					</p>
				</div>
			</div>
		</Tabs.Content>
	</Tabs>
</div>

<!-- Template editor modal -->
{#if modalTemplate}
	<TemplateEditorModal
		template={modalTemplate}
		onSave={saveTemplateFromModal}
		onClose={() => (modalTemplate = null)}
	/>
{/if}
