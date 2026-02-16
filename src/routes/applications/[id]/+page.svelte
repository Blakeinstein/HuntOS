<script lang="ts">
  let { data } = $props();

  const application = $derived(data.application);
  const history = $derived(data.history ?? []);
</script>

<section class="space-y-6">
  {#if application}
    <header>
      <h1 class="text-2xl font-semibold">{application.company}</h1>
      <p class="text-sm text-slate-600">{application.title}</p>
    </header>

    <div class="grid gap-6 md:grid-cols-2">
      <div class="space-y-3 rounded-lg border bg-white p-4">
        <h2 class="text-sm font-semibold text-slate-700">Application Details</h2>
        <dl class="space-y-2 text-sm text-slate-600">
          <div>
            <dt class="font-medium text-slate-700">Status</dt>
            <dd>{application.swimlane_name}</dd>
          </div>
          {#if application.job_description_url}
            <div>
              <dt class="font-medium text-slate-700">Job post</dt>
              <dd>
                <a class="text-blue-600 hover:underline" href={application.job_description_url}>
                  View posting
                </a>
              </dd>
            </div>
          {/if}
        </dl>
      </div>

      <div class="space-y-3 rounded-lg border bg-white p-4">
        <h2 class="text-sm font-semibold text-slate-700">History</h2>
        <ul class="space-y-2 text-sm text-slate-600">
          {#each history as entry (entry.id)}
            <li class="rounded-md bg-slate-50 p-3">
              <p class="font-medium text-slate-700">{entry.swimlane_name}</p>
              <p class="text-xs text-slate-500">{new Date(entry.created_at).toLocaleString()}</p>
              {#if entry.reason}
                <p class="text-xs text-slate-500">{entry.reason}</p>
              {/if}
            </li>
          {:else}
            <li class="text-xs text-slate-500">No history yet.</li>
          {/each}
        </ul>
      </div>
    </div>

    {#if application.fields?.length}
      <div class="rounded-lg border bg-white p-4">
        <h2 class="text-sm font-semibold text-slate-700">Form fields</h2>
        <div class="mt-3 grid gap-3 md:grid-cols-2">
          {#each application.fields as field (field.id)}
            <div class="rounded-md border border-slate-200 p-3 text-sm">
              <p class="font-medium text-slate-700">{field.field_name}</p>
              <p class="text-slate-500">{field.field_value || '—'}</p>
              <p class="text-xs text-slate-400">{field.status}</p>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {:else}
    <p class="text-sm text-slate-600">Loading application…</p>
  {/if}
</section>
