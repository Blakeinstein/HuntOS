<script lang="ts">
  import { invalidate } from '$app/navigation';

  let { data } = $props();

  const applications = $derived(data.applications ?? []);
  const swimlanes = $derived(data.swimlanes ?? []);

  let draggingId = $state<number | null>(null);

  function handleDragStart(event: DragEvent, applicationId: number) {
    draggingId = applicationId;
    event.dataTransfer?.setData('text/plain', String(applicationId));
    event.dataTransfer?.setDragImage(event.currentTarget as Element, 0, 0);
  }

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'move';
  }

  async function handleDrop(event: DragEvent, swimlaneId: number) {
    event.preventDefault();
    if (draggingId === null) return;

    await moveApplication(draggingId, swimlaneId);
    draggingId = null;
  }

  async function moveApplication(applicationId: number, swimlaneId: number) {
    await fetch(`/api/applications/${applicationId}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ swimlaneId, reason: 'Drag and drop', changedBy: 'user' })
    });

    await invalidate('db:applications');
  }
</script>

<section class="space-y-6">
  <header>
    <h1 class="text-2xl font-semibold">Applications</h1>
    <p class="text-sm text-slate-600">Drag applications between swimlanes to update status.</p>
  </header>

  <div class="flex gap-4 overflow-x-auto pb-4">
    {#each swimlanes as swimlane (swimlane.id)}
      <div
        class="min-w-[280px] max-w-[280px] rounded-lg border bg-slate-50 p-3"
        role="region"
        aria-label={`Applications in ${swimlane.name}`}
        ondragover={handleDragOver}
        ondrop={(event) => handleDrop(event, swimlane.id)}
      >
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-slate-700">{swimlane.name}</h2>
          <span class="rounded-full bg-white px-2 py-1 text-xs text-slate-600">
            {applications.filter((app) => app.status_swimlane_id === swimlane.id).length}
          </span>
        </div>

        <div class="space-y-2">
          {#each applications.filter((app) => app.status_swimlane_id === swimlane.id) as application (application.id)}
            <article
              class="cursor-move rounded-md border bg-white p-3 shadow-sm"
              draggable="true"
              role="listitem"
              ondragstart={(event) => handleDragStart(event, application.id)}
            >
              <h3 class="text-sm font-semibold text-slate-900">{application.company}</h3>
              <p class="text-xs text-slate-600">{application.title}</p>
            </article>
          {:else}
            <p class="text-xs text-slate-500">No applications yet.</p>
          {/each}
        </div>
      </div>
    {/each}
  </div>
</section>
