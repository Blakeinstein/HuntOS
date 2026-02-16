<script lang="ts">
  let { data } = $props();

  const completeness = $derived(data.completeness ?? 0);
  const incompleteFields = $derived(data.incompleteFields ?? []);
  const profileData = $derived(data.profile ?? {});

  let formState = $state<Record<string, string | string[]>>({});
  const mergedProfile = $derived.by(() => ({ ...profileData, ...formState }));

  const profileFields = [
    { key: 'name', label: 'Full name', type: 'text' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'phone', label: 'Phone', type: 'tel' },
    { key: 'location', label: 'Location', type: 'text' },
    { key: 'skills', label: 'Skills (comma-separated)', type: 'text' },
    { key: 'experience', label: 'Experience summary', type: 'textarea' },
    { key: 'education', label: 'Education', type: 'textarea' },
    { key: 'linkedin_url', label: 'LinkedIn URL', type: 'url' },
    { key: 'portfolio_url', label: 'Portfolio URL', type: 'url' }
  ];

  function handleInput(key: string, value: string) {
    formState = { ...formState, [key]: value };
  }

  async function saveProfile() {
    await fetch('/api/profiles', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(mergedProfile)
    });
  }
</script>

<section class="space-y-6">
  <header>
    <h1 class="text-2xl font-semibold">Profile</h1>
    <p class="text-sm text-slate-600">Keep your profile updated so automation can fill applications.</p>
  </header>

  <div class="rounded-lg border bg-white p-4">
    <div class="flex items-center justify-between">
      <div>
        <p class="text-sm font-semibold text-slate-700">Completeness</p>
        <p class="text-xs text-slate-500">Missing: {incompleteFields.join(', ') || 'None'}</p>
      </div>
      <span class="text-sm font-semibold text-slate-700">{completeness}%</span>
    </div>
    <div class="mt-3 h-2 rounded-full bg-slate-100">
      <div class="h-2 rounded-full bg-blue-500" style={`width: ${completeness}%`}></div>
    </div>
  </div>

  <form
    class="space-y-4"
    onsubmit={(event) => {
      event.preventDefault();
      saveProfile();
    }}
  >
    {#each profileFields as field (field.key)}
      <label class="block text-sm text-slate-700">
        <span class="font-medium">{field.label}</span>
        {#if field.type === 'textarea'}
          <textarea
            class="mt-2 w-full rounded-md border border-slate-200 p-2 text-sm"
            rows="3"
            value={formState[field.key] ?? profileData[field.key] ?? ''}
            oninput={(event) => handleInput(field.key, event.currentTarget.value)}
          ></textarea>
        {:else}
          <input
            class="mt-2 w-full rounded-md border border-slate-200 p-2 text-sm"
            type={field.type}
            value={formState[field.key] ?? profileData[field.key] ?? ''}
            oninput={(event) => handleInput(field.key, event.currentTarget.value)}
          />
        {/if}
      </label>
    {/each}

    <button class="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white" type="submit">
      Save profile
    </button>
  </form>
</section>
