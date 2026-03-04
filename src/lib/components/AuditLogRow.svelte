<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		ChevronDownIcon,
		ChevronRightIcon,
		CheckCircleIcon,
		AlertTriangleIcon,
		XCircleIcon,
		InfoIcon,
		ClockIcon,
		BotIcon,
		ExternalLinkIcon,
		ImageIcon,
		Loader2Icon,
		ChevronLeftIcon
	} from '@lucide/svelte';
	import type { AuditLogEntry } from '$lib/services/types';

	interface Props {
		entry: AuditLogEntry;
	}

	let { entry }: Props = $props();

	let expanded = $state(false);

	const statusConfig: Record<string, { icon: typeof CheckCircleIcon; color: string; bg: string }> =
		{
			success: { icon: CheckCircleIcon, color: 'text-success-500', bg: 'bg-success-500/10' },
			warning: { icon: AlertTriangleIcon, color: 'text-warning-500', bg: 'bg-warning-500/10' },
			error: { icon: XCircleIcon, color: 'text-error-500', bg: 'bg-error-500/10' },
			info: { icon: InfoIcon, color: 'text-tertiary-500', bg: 'bg-tertiary-500/10' }
		};

	const categoryLabels: Record<string, string> = {
		scrape: 'Scraping',
		browser: 'Browser',
		resume: 'Resume',
		agent: 'Agent',
		profile: 'Profile',
		application: 'Application'
	};

	const config = $derived(statusConfig[entry.status] ?? statusConfig.info);
	const StatusIcon = $derived(config.icon);

	const formattedDate = $derived.by(() => {
		const d = new Date(entry.created_at);
		return d.toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	});

	const formattedDuration = $derived.by(() => {
		if (entry.duration_ms == null) return null;
		if (entry.duration_ms < 1000) return `${entry.duration_ms}ms`;
		if (entry.duration_ms < 60_000) return `${(entry.duration_ms / 1000).toFixed(1)}s`;
		const mins = Math.floor(entry.duration_ms / 60_000);
		const secs = Math.round((entry.duration_ms % 60_000) / 1000);
		return `${mins}m ${secs}s`;
	});

	const hasMeta = $derived(entry.meta && Object.keys(entry.meta).length > 0);
	const hasExpandableContent = $derived(!!entry.detail || hasMeta);

	/** Extract applicationId from meta for rendering a backlink. */
	const linkedApplicationId = $derived(
		entry.meta && typeof entry.meta.applicationId === 'number' ? entry.meta.applicationId : null
	);

	/** Meta entries excluding keys rendered as dedicated UI elements. */
	const HIDDEN_META_KEYS = new Set(['applicationId', 'screenshotDir', 'pipelineRunId']);
	const displayMeta = $derived.by(() => {
		if (!entry.meta) return [];
		return Object.entries(entry.meta).filter(([key]) => !HIDDEN_META_KEYS.has(key));
	});

	// ── Screenshots ────────────────────────────────────────────────────────────

	const screenshotDir = $derived(
		entry.meta && typeof entry.meta.screenshotDir === 'string' ? entry.meta.screenshotDir : null
	);

	interface ScreenshotFile {
		name: string;
		relPath: string;
		size: number;
		modifiedAt: string;
	}

	let screenshots = $state<ScreenshotFile[]>([]);
	let screenshotsLoading = $state(false);
	let screenshotsFetched = $state(false);
	let lightboxIndex = $state<number | null>(null);

	/** Convert an absolute data/logs/screenshots/... path to the run-relative
	 *  query param by stripping the leading data/logs/screenshots/ prefix. */
	function dirToRunParam(dir: string): string {
		// Normalise slashes, strip leading data/logs/screenshots/
		const norm = dir.replace(/\\/g, '/');
		const prefix = 'data/logs/screenshots/';
		const idx = norm.indexOf(prefix);
		return idx >= 0 ? norm.slice(idx + prefix.length) : norm;
	}

	async function loadScreenshots(dir: string) {
		if (screenshotsFetched) return;
		screenshotsLoading = true;
		try {
			const run = dirToRunParam(dir);
			const res = await fetch(`/api/admin/screenshots?run=${encodeURIComponent(run)}`);
			if (res.ok) {
				const data = await res.json();
				screenshots = data.files ?? [];
			}
			screenshotsFetched = true;
		} catch {
			screenshotsFetched = true;
		} finally {
			screenshotsLoading = false;
		}
	}

	function screenshotUrl(dir: string, relPath: string): string {
		const run = dirToRunParam(dir);
		return `/api/admin/screenshots?run=${encodeURIComponent(run)}&file=${encodeURIComponent(relPath)}`;
	}

	function openLightbox(idx: number) {
		lightboxIndex = idx;
	}

	function closeLightbox() {
		lightboxIndex = null;
	}

	function lightboxPrev() {
		if (lightboxIndex !== null && lightboxIndex > 0) lightboxIndex--;
	}

	function lightboxNext() {
		if (lightboxIndex !== null && lightboxIndex < screenshots.length - 1) lightboxIndex++;
	}

	// Load screenshots when the row is expanded and has a screenshotDir
	$effect(() => {
		if (expanded && screenshotDir) {
			loadScreenshots(screenshotDir);
		}
	});
</script>

<div class="border-b border-surface-200-800 transition-colors hover:bg-surface-100-900/50">
	<!-- Main row -->
	<button
		type="button"
		class="flex w-full items-center gap-3 px-4 py-3 text-left"
		onclick={() => {
			if (hasExpandableContent) expanded = !expanded;
		}}
		aria-expanded={expanded}
		disabled={!hasExpandableContent}
	>
		<!-- Expand chevron -->
		<span class="flex w-4 shrink-0 items-center justify-center">
			{#if hasExpandableContent}
				{#if expanded}
					<ChevronDownIcon class="size-4 opacity-50" />
				{:else}
					<ChevronRightIcon class="size-4 opacity-50" />
				{/if}
			{/if}
		</span>

		<!-- Status icon -->
		<span class="flex size-7 shrink-0 items-center justify-center rounded-md {config.bg}">
			<StatusIcon class="size-4 {config.color}" />
		</span>

		<!-- Title & category -->
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-2">
				<span class="truncate text-sm font-medium">{entry.title}</span>
			</div>
			<div class="mt-0.5 flex items-center gap-2 text-xs opacity-50">
				<span class="badge preset-outlined-surface-500 px-1.5 py-0 text-[10px]">
					{categoryLabels[entry.category] ?? entry.category}
				</span>
				{#if entry.agent_id}
					<span class="flex items-center gap-1">
						<BotIcon class="size-3" />
						{entry.agent_id}
					</span>
				{/if}
				{#if linkedApplicationId}
					<a
						href={resolve(`/applications/${linkedApplicationId}`)}
						class="flex items-center gap-1 text-primary-500 hover:underline"
						onclick={(e) => e.stopPropagation()}
					>
						<ExternalLinkIcon class="size-3" />
						Application #{linkedApplicationId}
					</a>
				{/if}
			</div>
		</div>

		<!-- Duration -->
		{#if formattedDuration}
			<span class="flex shrink-0 items-center gap-1 text-xs opacity-50" title="Duration">
				<ClockIcon class="size-3" />
				{formattedDuration}
			</span>
		{/if}

		<!-- Timestamp -->
		<span class="shrink-0 text-xs opacity-40">
			{formattedDate}
		</span>
	</button>

	<!-- Expanded detail panel -->
	{#if expanded && hasExpandableContent}
		<div class="border-t border-surface-200-800 bg-surface-50-950/50 px-4 py-3 pl-14">
			{#if entry.detail}
				<div class="mb-3">
					<h4 class="mb-1 text-xs font-semibold tracking-wide uppercase opacity-40">Detail</h4>
					<p class="text-sm whitespace-pre-wrap opacity-80">{entry.detail}</p>
				</div>
			{/if}

			{#if linkedApplicationId}
				<div class="mb-3">
					<h4 class="mb-1 text-xs font-semibold tracking-wide uppercase opacity-40">Application</h4>
					<a
						href={resolve(`/applications/${linkedApplicationId}`)}
						class="inline-flex items-center gap-1.5 rounded-md border border-primary-500/30 bg-primary-500/10 px-2.5 py-1 text-xs font-medium text-primary-500 transition-colors hover:bg-primary-500/20"
					>
						<ExternalLinkIcon class="size-3" />
						View Application #{linkedApplicationId}
					</a>
				</div>
			{/if}

			{#if displayMeta.length > 0}
				<div>
					<h4 class="mb-1 text-xs font-semibold tracking-wide uppercase opacity-40">Metadata</h4>
					<div class="grid gap-1.5">
						{#each displayMeta as [key, value] (key)}
							<div class="flex items-start gap-2 text-xs">
								<span class="shrink-0 font-mono opacity-50">{key}:</span>
								<span class="font-mono opacity-80">
									{#if typeof value === 'object' && value !== null}
										{JSON.stringify(value, null, 2)}
									{:else if value === undefined}
										<span class="italic opacity-40">undefined</span>
									{:else}
										{String(value)}
									{/if}
								</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- ── Screenshots strip ─────────────────────────────────────────── -->
			{#if screenshotDir}
				<div>
					<h4
						class="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase opacity-40"
					>
						<ImageIcon class="size-3" />
						Screenshots
						{#if screenshots.length > 0}
							<span class="opacity-60">({screenshots.length})</span>
						{/if}
					</h4>

					{#if screenshotsLoading}
						<div class="flex items-center gap-2 py-2 text-xs opacity-40">
							<Loader2Icon class="size-3 animate-spin" />
							Loading…
						</div>
					{:else if screenshotsFetched && screenshots.length === 0}
						<p class="text-xs italic opacity-40">No screenshots captured yet.</p>
					{:else if screenshots.length > 0}
						<div class="flex gap-2 overflow-x-auto pb-1">
							{#each screenshots as shot, idx (shot.relPath)}
								<button
									type="button"
									class="group relative shrink-0 overflow-hidden rounded border border-surface-200-800 transition-all hover:border-primary-500 hover:shadow-md"
									onclick={(e) => {
										e.stopPropagation();
										openLightbox(idx);
									}}
									title={shot.relPath}
								>
									<img
										src={screenshotUrl(screenshotDir, shot.relPath)}
										alt={shot.name}
										class="h-24 w-auto object-cover"
										loading="lazy"
									/>
									<div
										class="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[9px] text-white opacity-0 transition-opacity group-hover:opacity-100"
									>
										{shot.name}
									</div>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- ── Lightbox ────────────────────────────────────────────────────────────── -->
{#if lightboxIndex !== null && screenshotDir}
	{@const shot = screenshots[lightboxIndex]}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
		onclick={closeLightbox}
		onkeydown={(e) => {
			if (e.key === 'Escape') closeLightbox();
			if (e.key === 'ArrowLeft') lightboxPrev();
			if (e.key === 'ArrowRight') lightboxNext();
		}}
	>
		<!-- Prev -->
		{#if lightboxIndex > 0}
			<button
				type="button"
				class="absolute top-1/2 left-4 -translate-y-1/2 rounded-full bg-white/10 p-2 hover:bg-white/20"
				onclick={(e) => {
					e.stopPropagation();
					lightboxPrev();
				}}
				aria-label="Previous screenshot"
			>
				<ChevronLeftIcon class="size-6 text-white" />
			</button>
		{/if}

		<!-- Image -->
		<div
			role="presentation"
			class="flex max-h-[90vh] max-w-[90vw] flex-col items-center gap-3"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<div class="font-mono text-xs text-white/60">
				{shot.relPath}
				<span class="ml-2 opacity-50">{lightboxIndex + 1} / {screenshots.length}</span>
			</div>
			<img
				src={screenshotUrl(screenshotDir, shot.relPath)}
				alt={shot.name}
				class="max-h-[80vh] max-w-[85vw] rounded object-contain shadow-2xl"
			/>
		</div>

		<!-- Next -->
		{#if lightboxIndex < screenshots.length - 1}
			<button
				type="button"
				class="absolute top-1/2 right-4 -translate-y-1/2 rounded-full bg-white/10 p-2 hover:bg-white/20"
				onclick={(e) => {
					e.stopPropagation();
					lightboxNext();
				}}
				aria-label="Next screenshot"
			>
				<ChevronRightIcon class="size-6 text-white" />
			</button>
		{/if}

		<!-- Close -->
		<button
			type="button"
			class="absolute top-4 right-4 rounded-full bg-white/10 p-1.5 hover:bg-white/20"
			onclick={closeLightbox}
			aria-label="Close"
		>
			<XCircleIcon class="size-5 text-white" />
		</button>
	</div>
{/if}
