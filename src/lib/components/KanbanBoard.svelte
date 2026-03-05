<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { PlusIcon, TrashIcon, ChevronLeftIcon, ChevronRightIcon } from '@lucide/svelte';
	import type { ApplicationWithSwimlane, Swimlane, PipelineRun } from '$lib/services/types';
	import { NON_REMOVABLE_SWIMLANES } from '$lib/services/types';
	import KanbanCard from './KanbanCard.svelte';
	import AddSwimlaneDialog from './AddSwimlaneDialog.svelte';

	interface ApplicationWithPipeline extends ApplicationWithSwimlane {
		active_pipeline_run: PipelineRun | null;
	}

	interface Props {
		applications: ApplicationWithPipeline[];
		swimlanes: Swimlane[];
	}

	let { applications, swimlanes }: Props = $props();

	// ── Local ordering (optimistic) ──────────────────────────────────────────
	// We keep a local copy of the ordered swimlane IDs so reorders feel instant.
	// It is re-synced whenever the `swimlanes` prop changes (server invalidation).
	// The canonical order from the server (derived from prop, always in sync).
	const serverOrder = $derived(swimlanes.map((s) => s.id));
	let localOrderOverride = $state<number[] | null>(null);
	// Initialise to empty string so the first derived run always sees a change and syncs.
	let prevServerKey = $state<string>('');

	const localOrder = $derived.by(() => {
		const key = JSON.stringify(serverOrder);
		if (key !== prevServerKey) {
			// Server order changed — clear any optimistic override and re-sync.
			// Scheduled via microtask to avoid mutating state inside a derived.
			Promise.resolve().then(() => {
				prevServerKey = key;
				localOrderOverride = null;
			});
		}
		return localOrderOverride ?? serverOrder;
	});

	const orderedSwimlanes = $derived(
		localOrder
			.map((id) => swimlanes.find((s) => s.id === id))
			.filter((s): s is Swimlane => s !== undefined)
	);

	// ── Card drag (application → swimlane) ──────────────────────────────────
	let draggingCardId = $state<number | null>(null);
	let dragOverSwimlaneId = $state<number | null>(null);

	// ── Column drag (swimlane reorder) ───────────────────────────────────────
	let draggingColumnId = $state<number | null>(null);
	let dragOverColumnId = $state<number | null>(null);
	// Tracks whether the pointer is in the left or right half of the target column.
	let dropSide = $state<'left' | 'right'>('right');

	let showAddSwimlane = $state(false);

	// ── Helpers ──────────────────────────────────────────────────────────────

	function getApplicationsForSwimlane(swimlaneId: number): ApplicationWithPipeline[] {
		return applications.filter((app) => app.status_swimlane_id === swimlaneId);
	}

	function isNonRemovable(swimlaneName: string): boolean {
		return NON_REMOVABLE_SWIMLANES.includes(
			swimlaneName as (typeof NON_REMOVABLE_SWIMLANES)[number]
		);
	}

	function getSwimlaneColor(name: string): string {
		switch (name.toLowerCase()) {
			case 'backlog':
				return 'border-t-surface-500';
			case 'in progress':
				return 'border-t-tertiary-500';
			case 'action required':
				return 'border-t-warning-500';
			case 'applied':
				return 'border-t-primary-500';
			case 'rejected':
				return 'border-t-error-500';
			default:
				return 'border-t-secondary-500';
		}
	}

	function getSwimlaneHeaderAccent(name: string): string {
		switch (name.toLowerCase()) {
			case 'in progress':
				return 'text-tertiary-500';
			default:
				return '';
		}
	}

	// ── Card drag handlers ───────────────────────────────────────────────────

	function handleCardDragStart(event: DragEvent, applicationId: number) {
		draggingCardId = applicationId;
		if (event.dataTransfer) {
			event.dataTransfer.setData('application/card-id', String(applicationId));
			event.dataTransfer.effectAllowed = 'move';
		}
	}

	function handleSwimlaneBodyDragOver(event: DragEvent, swimlaneId: number) {
		// Only respond to card drags
		if (!event.dataTransfer?.types.includes('application/card-id')) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		dragOverSwimlaneId = swimlaneId;
	}

	function handleSwimlaneBodyDragLeave(event: DragEvent, swimlaneId: number) {
		// Only clear if leaving the swimlane entirely (not just entering a child)
		const related = event.relatedTarget as HTMLElement | null;
		if (related && (event.currentTarget as HTMLElement).contains(related)) return;
		if (dragOverSwimlaneId === swimlaneId) dragOverSwimlaneId = null;
	}

	async function handleCardDrop(event: DragEvent, swimlaneId: number) {
		if (!event.dataTransfer?.types.includes('application/card-id')) return;
		event.preventDefault();
		dragOverSwimlaneId = null;

		if (draggingCardId === null) return;

		const app = applications.find((a) => a.id === draggingCardId);
		if (app && app.status_swimlane_id === swimlaneId) {
			draggingCardId = null;
			return;
		}

		await fetch(`/api/applications/${draggingCardId}/move`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ swimlaneId, reason: 'Drag and drop', changedBy: 'user' })
		});

		draggingCardId = null;
		await invalidate('db:applications');
	}

	function handleCardDragEnd() {
		draggingCardId = null;
		dragOverSwimlaneId = null;
	}

	// ── Column drag handlers ─────────────────────────────────────────────────

	function handleColumnDragStart(event: DragEvent, swimlaneId: number) {
		draggingColumnId = swimlaneId;
		if (event.dataTransfer) {
			event.dataTransfer.setData('application/column-id', String(swimlaneId));
			event.dataTransfer.effectAllowed = 'move';
		}
	}

	function handleColumnDragOver(event: DragEvent, swimlaneId: number) {
		if (!event.dataTransfer?.types.includes('application/column-id')) return;
		if (swimlaneId === draggingColumnId) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = 'move';
		dragOverColumnId = swimlaneId;

		// Determine which half of the column the pointer is over
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		dropSide = event.clientX - rect.left < rect.width / 2 ? 'left' : 'right';
	}

	function handleColumnDragLeave(event: DragEvent, swimlaneId: number) {
		const related = event.relatedTarget as HTMLElement | null;
		if (related && (event.currentTarget as HTMLElement).contains(related)) return;
		if (dragOverColumnId === swimlaneId) {
			dragOverColumnId = null;
		}
	}

	async function handleColumnDrop(event: DragEvent, targetSwimlaneId: number) {
		if (!event.dataTransfer?.types.includes('application/column-id')) return;
		event.preventDefault();
		dragOverColumnId = null;

		if (draggingColumnId === null || draggingColumnId === targetSwimlaneId) {
			draggingColumnId = null;
			return;
		}

		const newOrder = [...localOrder];
		const fromIdx = newOrder.indexOf(draggingColumnId);
		const toIdx = newOrder.indexOf(targetSwimlaneId);

		if (fromIdx === -1 || toIdx === -1) {
			draggingColumnId = null;
			return;
		}

		// Remove dragging column and insert at the correct side of the target
		newOrder.splice(fromIdx, 1);
		const insertAt = newOrder.indexOf(targetSwimlaneId) + (dropSide === 'right' ? 1 : 0);
		newOrder.splice(insertAt, 0, draggingColumnId);

		draggingColumnId = null;

		// Optimistic update
		localOrderOverride = newOrder;

		await fetch('/api/swimlanes', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ orderedIds: newOrder })
		});

		await invalidate('db:swimlanes');
	}

	function handleColumnDragEnd() {
		draggingColumnId = null;
		dragOverColumnId = null;
	}

	// ── Up / Down arrow reorder ───────────────────────────────────────────────

	async function moveColumn(swimlaneId: number, direction: 'left' | 'right') {
		const newOrder = [...localOrder];
		const idx = newOrder.indexOf(swimlaneId);
		if (idx === -1) return;

		if (direction === 'left' && idx === 0) return;
		if (direction === 'right' && idx === newOrder.length - 1) return;

		const swapIdx = direction === 'left' ? idx - 1 : idx + 1;
		[newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]];

		// Optimistic update
		localOrderOverride = newOrder;

		await fetch('/api/swimlanes', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ orderedIds: newOrder })
		});

		await invalidate('db:swimlanes');
	}

	// ── Add / Delete ─────────────────────────────────────────────────────────

	async function handleDeleteSwimlane(swimlaneId: number) {
		const swimlane = swimlanes.find((s) => s.id === swimlaneId);
		if (!swimlane || !swimlane.is_custom) return;

		const appsInSwimlane = getApplicationsForSwimlane(swimlaneId);
		if (appsInSwimlane.length > 0) {
			alert('Cannot delete a swimlane that still has applications. Move them first.');
			return;
		}

		await fetch(`/api/swimlanes/${swimlaneId}`, { method: 'DELETE' });
		await invalidate('db:swimlanes');
	}

	async function handleAddSwimlane(name: string) {
		await fetch('/api/swimlanes', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name })
		});
		showAddSwimlane = false;
		await invalidate('db:swimlanes');
	}
</script>

<div class="flex h-full flex-col gap-4">
	<!-- Board header -->
	<div class="flex items-center justify-between">
		<div>
			<h1 class="h3 font-bold">Roadmap</h1>
			<p class="text-sm opacity-60">
				Drag applications between swimlanes. Drag column headers to reorder.
			</p>
		</div>
		<button
			type="button"
			class="btn gap-2 preset-filled-primary-500"
			onclick={() => (showAddSwimlane = true)}
		>
			<PlusIcon class="size-4" />
			<span>Add Swimlane</span>
		</button>
	</div>

	<!-- Kanban columns -->
	<div class="flex flex-1 gap-4 overflow-x-auto pb-4">
		{#each orderedSwimlanes as swimlane, colIdx (swimlane.id)}
			{@const swimlaneApps = getApplicationsForSwimlane(swimlane.id)}
			{@const isCardDragOver = dragOverSwimlaneId === swimlane.id && draggingCardId !== null}
			{@const isColumnDragging = draggingColumnId === swimlane.id}
			{@const isColumnDragOver = dragOverColumnId === swimlane.id && draggingColumnId !== null}
			{@const canDelete = swimlane.is_custom && !isNonRemovable(swimlane.name)}
			{@const isInProgress = swimlane.name.toLowerCase() === 'in progress'}
			{@const isFirst = colIdx === 0}
			{@const isLast = colIdx === orderedSwimlanes.length - 1}

			<!-- Drop-left indicator gap -->
			{#if isColumnDragOver && dropSide === 'left'}
				<div class="w-1 shrink-0 rounded-full bg-primary-500 opacity-70"></div>
			{/if}

			<div
				class="flex max-w-[320px] min-w-75 shrink-0 flex-col rounded-lg border-t-4 bg-surface-50-950 shadow-sm transition-opacity {getSwimlaneColor(
					swimlane.name
				)}"
				class:opacity-40={isColumnDragging}
				class:ring-2={isCardDragOver}
				class:ring-primary-500={isCardDragOver}
				class:ring-dashed={isColumnDragOver}
				class:ring-surface-400-600={isColumnDragOver && dropSide !== 'left' && dropSide !== 'right'}
				role="region"
				aria-label="Swimlane: {swimlane.name}"
				ondragover={(e) => {
					handleSwimlaneBodyDragOver(e, swimlane.id);
					handleColumnDragOver(e, swimlane.id);
				}}
				ondragleave={(e) => {
					handleSwimlaneBodyDragLeave(e, swimlane.id);
					handleColumnDragLeave(e, swimlane.id);
				}}
				ondrop={(e) => {
					handleCardDrop(e, swimlane.id);
					handleColumnDrop(e, swimlane.id);
				}}
			>
				<!-- Swimlane header — drag handle for column reorder -->
				<div
					class="group flex cursor-grab items-center justify-between border-b border-surface-200-800 px-3 py-2.5 active:cursor-grabbing"
					draggable="true"
					ondragstart={(e) => handleColumnDragStart(e, swimlane.id)}
					ondragend={handleColumnDragEnd}
					role="button"
					tabindex="0"
					aria-label="Drag to reorder {swimlane.name} column"
				>
					<div class="flex min-w-0 flex-1 items-center gap-2">
						<h2
							class="truncate text-sm font-bold {getSwimlaneHeaderAccent(swimlane.name)}"
							class:animate-pulse={isInProgress && swimlaneApps.length > 0}
						>
							{swimlane.name}
						</h2>
						<span
							class="badge shrink-0 text-xs"
							class:preset-filled-tertiary-500={isInProgress && swimlaneApps.length > 0}
							class:preset-outlined-surface-500={!isInProgress || swimlaneApps.length === 0}
						>
							{swimlaneApps.length}
						</span>
					</div>

					<!-- Header action buttons -->
					<div class="flex shrink-0 items-center gap-0.5">
						<!-- Move left -->
						<button
							type="button"
							class="btn-icon btn-icon-sm opacity-0 transition-opacity group-hover:opacity-100 hover:preset-tonal-surface"
							class:!opacity-0={isFirst}
							class:pointer-events-none={isFirst}
							title="Move left"
							aria-label="Move {swimlane.name} left"
							onclick={(e) => {
								e.stopPropagation();
								moveColumn(swimlane.id, 'left');
							}}
						>
							<ChevronLeftIcon class="size-3.5" />
						</button>

						<!-- Move right -->
						<button
							type="button"
							class="btn-icon btn-icon-sm opacity-0 transition-opacity group-hover:opacity-100 hover:preset-tonal-surface"
							class:!opacity-0={isLast}
							class:pointer-events-none={isLast}
							title="Move right"
							aria-label="Move {swimlane.name} right"
							onclick={(e) => {
								e.stopPropagation();
								moveColumn(swimlane.id, 'right');
							}}
						>
							<ChevronRightIcon class="size-3.5" />
						</button>

						<!-- Delete (custom only) -->
						{#if canDelete}
							<button
								type="button"
								class="btn-icon btn-icon-sm opacity-0 transition-opacity group-hover:opacity-100 hover:preset-tonal-error"
								title="Delete swimlane"
								aria-label="Delete {swimlane.name} swimlane"
								onclick={(e) => {
									e.stopPropagation();
									handleDeleteSwimlane(swimlane.id);
								}}
							>
								<TrashIcon class="size-3.5" />
							</button>
						{/if}
					</div>
				</div>

				<!-- Cards area -->
				<div class="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
					{#each swimlaneApps as application (application.id)}
						<KanbanCard
							{application}
							activePipelineRun={application.active_pipeline_run}
							isDragging={draggingCardId === application.id}
							onDragStart={(e) => handleCardDragStart(e, application.id)}
							onDragEnd={handleCardDragEnd}
						/>
					{:else}
						<div
							class="flex items-center justify-center rounded-md border border-dashed border-surface-300-700 p-6"
						>
							<p class="text-xs opacity-50">No applications</p>
						</div>
					{/each}
				</div>
			</div>

			<!-- Drop-right indicator gap -->
			{#if isColumnDragOver && dropSide === 'right'}
				<div class="w-1 shrink-0 rounded-full bg-primary-500 opacity-70"></div>
			{/if}
		{/each}
	</div>
</div>

{#if showAddSwimlane}
	<AddSwimlaneDialog onSubmit={handleAddSwimlane} onClose={() => (showAddSwimlane = false)} />
{/if}
