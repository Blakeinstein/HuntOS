<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { PlusIcon, TrashIcon } from '@lucide/svelte';
	import type { ApplicationWithSwimlane, Swimlane } from '$lib/services';
	import KanbanCard from './KanbanCard.svelte';
	import AddSwimlaneDialog from './AddSwimlaneDialog.svelte';

	interface Props {
		applications: ApplicationWithSwimlane[];
		swimlanes: Swimlane[];
	}

	let { applications, swimlanes }: Props = $props();

	let draggingId = $state<number | null>(null);
	let dragOverSwimlaneId = $state<number | null>(null);
	let showAddSwimlane = $state(false);

	function getApplicationsForSwimlane(swimlaneId: number): ApplicationWithSwimlane[] {
		return applications.filter((app) => app.status_swimlane_id === swimlaneId);
	}

	function handleDragStart(event: DragEvent, applicationId: number) {
		draggingId = applicationId;
		if (event.dataTransfer) {
			event.dataTransfer.setData('text/plain', String(applicationId));
			event.dataTransfer.effectAllowed = 'move';
		}
	}

	function handleDragOver(event: DragEvent, swimlaneId: number) {
		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'move';
		}
		dragOverSwimlaneId = swimlaneId;
	}

	function handleDragLeave() {
		dragOverSwimlaneId = null;
	}

	async function handleDrop(event: DragEvent, swimlaneId: number) {
		event.preventDefault();
		dragOverSwimlaneId = null;

		if (draggingId === null) return;

		const app = applications.find((a) => a.id === draggingId);
		if (app && app.status_swimlane_id === swimlaneId) {
			draggingId = null;
			return;
		}

		await fetch(`/api/applications/${draggingId}/move`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ swimlaneId, reason: 'Drag and drop', changedBy: 'user' })
		});

		draggingId = null;
		await invalidate('db:applications');
	}

	function handleDragEnd() {
		draggingId = null;
		dragOverSwimlaneId = null;
	}

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

	function getSwimlaneColor(name: string): string {
		switch (name.toLowerCase()) {
			case 'backlog':
				return 'border-t-surface-500';
			case 'applied':
				return 'border-t-primary-500';
			case 'rejected':
				return 'border-t-error-500';
			case 'action required':
				return 'border-t-warning-500';
			default:
				return 'border-t-secondary-500';
		}
	}
</script>

<div class="flex h-full flex-col gap-4">
	<!-- Board header -->
	<div class="flex items-center justify-between">
		<div>
			<h1 class="h3 font-bold">Roadmap</h1>
			<p class="text-sm opacity-60">Drag applications between swimlanes to update their status.</p>
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
		{#each swimlanes as swimlane (swimlane.id)}
			{@const swimlaneApps = getApplicationsForSwimlane(swimlane.id)}
			{@const isDragOver = dragOverSwimlaneId === swimlane.id}
			<div
				class="flex max-w-[320px] min-w-75 shrink-0 flex-col rounded-lg border-t-4 bg-surface-50-950 shadow-sm {getSwimlaneColor(
					swimlane.name
				)}"
				class:ring-2={isDragOver}
				class:ring-primary-500={isDragOver}
				role="region"
				aria-label="Swimlane: {swimlane.name}"
				ondragover={(e) => handleDragOver(e, swimlane.id)}
				ondragleave={handleDragLeave}
				ondrop={(e) => handleDrop(e, swimlane.id)}
			>
				<!-- Swimlane header -->
				<div class="flex items-center justify-between border-b border-surface-200-800 px-3 py-2.5">
					<div class="flex items-center gap-2">
						<h2 class="text-sm font-bold">{swimlane.name}</h2>
						<span class="badge preset-outlined-surface-500 text-xs">
							{swimlaneApps.length}
						</span>
					</div>
					{#if swimlane.is_custom}
						<button
							type="button"
							class="btn-icon btn-icon-sm hover:preset-tonal-error"
							title="Delete swimlane"
							onclick={() => handleDeleteSwimlane(swimlane.id)}
						>
							<TrashIcon class="size-3.5" />
						</button>
					{/if}
				</div>

				<!-- Cards area -->
				<div class="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
					{#each swimlaneApps as application (application.id)}
						<KanbanCard
							{application}
							isDragging={draggingId === application.id}
							onDragStart={(e) => handleDragStart(e, application.id)}
							onDragEnd={handleDragEnd}
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
		{/each}
	</div>
</div>

{#if showAddSwimlane}
	<AddSwimlaneDialog onSubmit={handleAddSwimlane} onClose={() => (showAddSwimlane = false)} />
{/if}
