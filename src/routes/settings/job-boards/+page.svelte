<script lang="ts">
  import { invalidate } from '$app/navigation';

  let { data } = $props();
  const jobBoards = $derived(data.jobBoards ?? []);

  let formState = $state({
    name: '',
    baseUrl: '',
    checkIntervalMinutes: '1440'
  });

  async function addJobBoard() {
    await fetch('/api/job-boards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: formState.name,
        baseUrl: formState.baseUrl,
        checkIntervalMinutes: Number(formState.checkIntervalMinutes)
      })
    });

    formState = { ...formState, name: '', baseUrl: '' };
    await invalidate('db:job-boards');
  }
</script>

<section class="space-y-6">
  <header>
    <h1 class="text-2xl font-semibold">Job boards</h1>
    <p class="text-sm text-slate-600">Configure sources for new job postings.</p>
  </header>

  <div class="rounded-lg border bg-white p-4">
    <h2 class="text-sm font-semibold text-slate-700">Configured boards</h2>
    <div class="mt-3 space-y-2 text-sm text-slate-600">
      {#each jobBoards as board (board.id)}
        <div class="rounded-md border border-slate-200 p-3">
          <p class="font-medium text-slate-700">{board.name}</p>
          <p class="text-xs text-slate-500">{board.base_url}</p>
        </div>
      {:else}
        <p class="text-xs text-slate-500">No job boards configured yet.</p>
      {/each}
    </div>
  </div>

  <form
    class="rounded-lg border bg-white p-4"
    onsubmit={(event) => {
      event.preventDefault();
      addJobBoard();
    }}
  >
    <h2 class="text-sm font-semibold text-slate-700">Add job board</h2>
    <div class="mt-3 grid gap-3 md:grid-cols-2">
      <label class="text-sm text-slate-700">
        Name
        <input class="mt-1 w-full rounded-md border border-slate-200 p-2" bind:value={formState.name} />
      </label>
      <label class="text-sm text-slate-700">
        Base URL
        <input class="mt-1 w-full rounded-md border border-slate-200 p-2" bind:value={formState.baseUrl} />
      </label>
      <label class="text-sm text-slate-700">
        Check interval (minutes)
        <input
          class="mt-1 w-full rounded-md border border-slate-200 p-2"
          bind:value={formState.checkIntervalMinutes}
        />
      </label>
    </div>
    <button class="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white" type="submit">
      Save job board
    </button>
  </form>
</section>
