<script lang="ts">
	import { BriefcaseIcon, BuildingIcon, CalendarIcon, ExternalLinkIcon } from '@lucide/svelte';
	import type { ApplicationWithSwimlane } from '$lib/services';

	interface Props {
		application: ApplicationWithSwimlane;
		isDragging: boolean;
		onDragStart: (event: DragEvent) => void;
		onDragEnd: () => void;
	}

	let { application, isDragging, onDragStart, onDragEnd }: Props = $props();

	const formattedDate = $derived(
		new Date(application.created_at).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric'
		})
	);

	const missingFieldsCount = $derived(
		application.fields?.filter((f) => f.status === 'missing' || f.status === 'user_input_required')
			.length ?? 0
	);
</script>

<a
	href="/applications/{application.id}"
	class="block cursor-grab card rounded-md border border-surface-200-800 bg-surface-50-950 p-3 shadow-sm transition-all hover:border-primary-500 hover:shadow-md active:cursor-grabbing"
	class:opacity-40={isDragging}
	class:ring-2={isDragging}
	class:ring-primary-500={isDragging}
	draggable="true"
	ondragstart={onDragStart}
	ondragend={onDragEnd}
>
	<!-- Company & Title -->
	<div class="mb-2 flex items-start justify-between gap-2">
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-1.5">
				<BuildingIcon class="size-3.5 shrink-0 text-primary-500" />
				<h3 class="truncate text-sm font-bold">{application.company}</h3>
			</div>
			<div class="mt-0.5 flex items-center gap-1.5">
				<BriefcaseIcon class="size-3 shrink-0 opacity-50" />
				<p class="truncate text-xs opacity-70">{application.title}</p>
			</div>
		</div>
		{#if application.job_description_url}
			<span class="shrink-0 opacity-40">
				<ExternalLinkIcon class="size-3.5" />
			</span>
		{/if}
	</div>

	<!-- Footer: date + badges -->
	<div class="flex items-center justify-between gap-2">
		<div class="flex items-center gap-1 text-xs opacity-50">
			<CalendarIcon class="size-3" />
			<span>{formattedDate}</span>
		</div>
		<div class="flex items-center gap-1">
			{#if missingFieldsCount > 0}
				<span class="badge preset-filled-warning-500 text-[10px]">
					{missingFieldsCount} missing
				</span>
			{/if}
			{#if application.fields && application.fields.length > 0}
				<span class="badge preset-outlined-surface-500 text-[10px]">
					{application.fields.filter((f) => f.status === 'filled').length}/{application.fields
						.length} fields
				</span>
			{/if}
		</div>
	</div>
</a>
