<script lang="ts">
  import { invalidate } from '$app/navigation';

  let { data } = $props();
  const accounts = $derived(data.emailAccounts ?? []);

  let formState = $state({
    provider: 'imap',
    host: '',
    port: '993',
    username: '',
    password: '',
    isDefault: false
  });

  async function addAccount() {
    await fetch('/api/email-accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: formState.provider,
        host: formState.host,
        port: Number(formState.port),
        username: formState.username,
        password: formState.password,
        isDefault: formState.isDefault
      })
    });

    formState = { ...formState, password: '' };
    await invalidate('db:email-accounts');
  }
</script>

<section class="space-y-6">
  <header>
    <h1 class="text-2xl font-semibold">Email connections</h1>
    <p class="text-sm text-slate-600">Monitor inboxes for application status updates.</p>
  </header>

  <div class="rounded-lg border bg-white p-4">
    <h2 class="text-sm font-semibold text-slate-700">Connected accounts</h2>
    <div class="mt-3 space-y-2 text-sm text-slate-600">
      {#each accounts as account (account.id)}
        <div class="flex items-center justify-between rounded-md border border-slate-200 p-3">
          <div>
            <p class="font-medium text-slate-700">{account.provider}</p>
            <p class="text-xs text-slate-500">{account.username}</p>
          </div>
          {#if account.is_default}
            <span class="rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-700">Default</span>
          {/if}
        </div>
      {:else}
        <p class="text-xs text-slate-500">No email accounts connected yet.</p>
      {/each}
    </div>
  </div>

  <form
    class="rounded-lg border bg-white p-4"
    onsubmit={(event) => {
      event.preventDefault();
      addAccount();
    }}
  >
    <h2 class="text-sm font-semibold text-slate-700">Add account</h2>
    <div class="mt-3 grid gap-3 md:grid-cols-2">
      <label class="text-sm text-slate-700">
        Provider
        <select class="mt-1 w-full rounded-md border border-slate-200 p-2" bind:value={formState.provider}>
          <option value="imap">IMAP</option>
          <option value="gmail">Gmail</option>
          <option value="outlook">Outlook</option>
        </select>
      </label>
      <label class="text-sm text-slate-700">
        Host
        <input class="mt-1 w-full rounded-md border border-slate-200 p-2" bind:value={formState.host} />
      </label>
      <label class="text-sm text-slate-700">
        Port
        <input class="mt-1 w-full rounded-md border border-slate-200 p-2" bind:value={formState.port} />
      </label>
      <label class="text-sm text-slate-700">
        Username
        <input class="mt-1 w-full rounded-md border border-slate-200 p-2" bind:value={formState.username} />
      </label>
      <label class="text-sm text-slate-700">
        Password
        <input
          class="mt-1 w-full rounded-md border border-slate-200 p-2"
          type="password"
          bind:value={formState.password}
        />
      </label>
      <label class="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" bind:checked={formState.isDefault} />
        Default account
      </label>
    </div>
    <button class="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white" type="submit">
      Save account
    </button>
  </form>
</section>
