<script lang="ts">
	import {
		BriefcaseIcon,
		BuildingIcon,
		BookmarkIcon,
		InfoIcon,
		LinkIcon,
		SaveIcon,
		XIcon
	} from '@lucide/svelte';
	import type { Application } from '$lib/services/types';

	interface Props {
		application: Application;
		onSubmit: (data: {
			title: string;
			company: string;
			job_description_url?: string;
			job_description?: string;
		}) => Promise<void>;
		onClose: () => void;
	}

	let { application, onSubmit, onClose }: Props = $props();

	// Read initial values once via a function to avoid state_referenced_locally warnings.
	// The dialog intentionally captures the snapshot at open-time; the user edits from there.
	function initial<T>(fn: () => T): T {
		return fn();
	}

	let title = $state(initial(() => application.title));
	let company = $state(initial(() => application.company));
	let job_description_url = $state(initial(() => application.job_description_url ?? ''));
	let job_description = $state(initial(() => application.job_description ?? ''));

	const hasNoUrl = $derived(!job_description_url.trim());

	let isSubmitting = $state(false);
	let errors = $state<{ title?: string; company?: string; general?: string }>({});

	function validate(): boolean {
		const next: typeof errors = {};
		if (!title.trim()) next.title = 'Job title is required.';
		if (!company.trim()) next.company = 'Company name is required.';
		errors = next;
		return Object.keys(next).length === 0;
	}

	async function handleSubmit() {
		if (!validate()) return;

		isSubmitting = true;
		errors = {};

		try {
			await onSubmit({
				title: title.trim(),
				company: company.trim(),
				job_description_url: job_description_url.trim() || undefined,
				job_description: job_description.trim() || undefined
			});
		} catch (err) {
			errors = { general: err instanceof Error ? err.message : 'Something went wrong.' };
		} finally {
			isSubmitting = false;
		}
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
		class="w-full max-w-lg card border border-surface-200-800 bg-surface-50-950 p-6 shadow-xl"
		onclick={(e) => e.stopPropagation()}
	>
		<header class="mb-5 flex items-center justify-between">
			<div>
				<h2 class="h4 font-bold">Edit Job Opening</h2>
				<p class="mt-0.5 text-xs opacity-50">
					{application.company} — {application.title}
				</p>
			</div>
			<button
				type="button"
				class="btn-icon btn-icon-sm hover:preset-tonal"
				onclick={onClose}
				aria-label="Close dialog"
				disabled={isSubmitting}
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
			<!-- Title -->
			<label class="label">
				<span class="flex items-center gap-1.5 text-sm font-medium">
					<BriefcaseIcon class="size-3.5 opacity-60" />
					Job Title <span class="text-error-500">*</span>
				</span>
				<input
					type="text"
					class="mt-1 input"
					class:input-error={!!errors.title}
					placeholder="e.g. Senior Software Engineer"
					bind:value={title}
					disabled={isSubmitting}
				/>
				{#if errors.title}
					<p class="mt-1 text-xs text-error-500">{errors.title}</p>
				{/if}
			</label>

			<!-- Company -->
			<label class="label">
				<span class="flex items-center gap-1.5 text-sm font-medium">
					<BuildingIcon class="size-3.5 opacity-60" />
					Company <span class="text-error-500">*</span>
				</span>
				<input
					type="text"
					class="mt-1 input"
					class:input-error={!!errors.company}
					placeholder="e.g. Acme Corp"
					bind:value={company}
					disabled={isSubmitting}
				/>
				{#if errors.company}
					<p class="mt-1 text-xs text-error-500">{errors.company}</p>
				{/if}
			</label>

			<!-- Job Posting URL -->
			<label class="label">
				<span class="flex items-center gap-1.5 text-sm font-medium">
					<LinkIcon class="size-3.5 opacity-60" />
					Job Posting URL
					<span class="text-xs font-normal opacity-40">(optional)</span>
				</span>
				<input
					type="url"
					class="mt-1 input"
					placeholder="https://example.com/jobs/123"
					bind:value={job_description_url}
					disabled={isSubmitting}
				/>
			</label>

			<!-- URL behaviour callout -->
			{#if hasNoUrl}
				<div
					class="flex gap-2.5 rounded-lg border border-secondary-500/30 bg-secondary-500/8 px-3 py-2.5"
				>
					<BookmarkIcon class="mt-0.5 size-3.5 shrink-0 text-secondary-400" />
					<div class="space-y-0.5 text-xs">
						<p class="font-semibold text-secondary-400">Tracking only</p>
						<p class="leading-relaxed opacity-70">
							Without a URL, HuntOS can't auto-apply for you. The job will remain in your Backlog so
							you can track it manually.
						</p>
					</div>
				</div>
			{:else}
				<div
					class="flex gap-2.5 rounded-lg border border-primary-500/30 bg-primary-500/8 px-3 py-2.5"
				>
					<InfoIcon class="mt-0.5 size-3.5 shrink-0 text-primary-400" />
					<p class="text-xs leading-relaxed opacity-70">
						HuntOS will use this URL to research the role and auto-submit the application when you
						hit <strong class="opacity-90">Apply</strong> on the Backlog card.
					</p>
				</div>
			{/if}

			<!-- Job Description -->
			<label class="label">
				<span class="text-sm font-medium">
					Job Description
					<span class="text-xs font-normal opacity-40">(optional)</span>
				</span>
				<textarea
					class="mt-1 textarea h-28 resize-none"
					placeholder="Paste the job description here…"
					bind:value={job_description}
					disabled={isSubmitting}
				></textarea>
			</label>

			{#if errors.general}
				<p class="rounded-md bg-error-500/10 px-3 py-2 text-xs text-error-500">
					{errors.general}
				</p>
			{/if}

			<div class="flex justify-end gap-2 pt-1">
				<button type="button" class="btn preset-tonal" onclick={onClose} disabled={isSubmitting}>
					Cancel
				</button>
				<button type="submit" class="btn gap-1.5 preset-filled-primary-500" disabled={isSubmitting}>
					<SaveIcon class="size-4" />
					<span>{isSubmitting ? 'Saving…' : 'Save Changes'}</span>
				</button>
			</div>
		</form>
	</div>
</div>
