<script lang="ts">
	import {
		ChevronDownIcon,
		ChevronRightIcon,
		CheckCircleIcon,
		AlertTriangleIcon,
		XCircleIcon,
		InfoIcon,
		ClockIcon,
		BotIcon
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
		agent: 'Agent'
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

			{#if hasMeta}
				<div>
					<h4 class="mb-1 text-xs font-semibold tracking-wide uppercase opacity-40">Metadata</h4>
					<div class="grid gap-1.5">
						{#each Object.entries(entry.meta ?? {}) as [key, value] (key)}
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
		</div>
	{/if}
</div>
