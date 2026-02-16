<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { Switch } from '@skeletonlabs/skeleton-svelte';
	import {
		MailIcon,
		PlusIcon,
		TrashIcon,
		ArrowLeftIcon,
		ServerIcon,
		UserIcon,
		LockIcon,
		ShieldAlertIcon,
		CheckCircleIcon
	} from '@lucide/svelte';

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

	let isAdding = $state(false);
	let showForm = $state(false);
	let deleteConfirmId = $state<number | null>(null);

	async function addAccount() {
		isAdding = true;
		try {
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

			formState = {
				provider: 'imap',
				host: '',
				port: '993',
				username: '',
				password: '',
				isDefault: false
			};
			showForm = false;
			await invalidate('db:email-accounts');
		} finally {
			isAdding = false;
		}
	}

	async function deleteAccount(id: number) {
		await fetch(`/api/email-accounts/${id}`, { method: 'DELETE' });
		deleteConfirmId = null;
		await invalidate('db:email-accounts');
	}

	function getProviderLabel(provider: string): string {
		switch (provider) {
			case 'gmail':
				return 'Gmail';
			case 'outlook':
				return 'Outlook';
			case 'imap':
				return 'IMAP';
			default:
				return provider;
		}
	}

	function getProviderColor(provider: string): string {
		switch (provider) {
			case 'gmail':
				return 'preset-filled-error-500';
			case 'outlook':
				return 'preset-filled-primary-500';
			default:
				return 'preset-filled-surface-500';
		}
	}
</script>

<div class="mx-auto max-w-3xl space-y-6">
	<!-- Page header -->
	<div class="flex items-start justify-between gap-4">
		<div class="flex items-start gap-3">
			<a
				href="/settings"
				class="mt-1 btn-icon btn-icon-sm preset-tonal"
				aria-label="Back to settings"
			>
				<ArrowLeftIcon class="size-4" />
			</a>
			<div>
				<h1 class="h3 font-bold">Email Connections</h1>
				<p class="text-sm opacity-60">
					Connect email accounts to automatically track application status updates.
				</p>
			</div>
		</div>
		<button
			type="button"
			class="btn gap-2 preset-filled-primary-500"
			onclick={() => (showForm = !showForm)}
		>
			<PlusIcon class="size-4" />
			<span>Add Account</span>
		</button>
	</div>

	<!-- Security notice -->
	<div class="flex items-start gap-3 card border border-warning-500/30 bg-warning-500/5 p-4">
		<ShieldAlertIcon class="mt-0.5 size-5 shrink-0 text-warning-500" />
		<div>
			<p class="text-sm font-semibold text-warning-500">Security Notice</p>
			<p class="mt-0.5 text-xs opacity-60">
				Email credentials are stored with basic encoding. For Gmail, use an
				<a
					href="https://support.google.com/accounts/answer/185833"
					target="_blank"
					rel="noopener noreferrer"
					class="text-primary-500 hover:underline"
				>
					App Password
				</a>
				instead of your main password. OAuth integration is planned for a future release.
			</p>
		</div>
	</div>

	<!-- Connected accounts list -->
	<div class="card border border-surface-200-800 bg-surface-50-950 p-5">
		<h2 class="mb-4 flex items-center gap-2 text-sm font-bold">
			<MailIcon class="size-4 text-primary-500" />
			Connected Accounts
			<span class="badge preset-outlined-surface-500 text-xs">{accounts.length}</span>
		</h2>

		{#if accounts.length > 0}
			<div class="space-y-3">
				{#each accounts as account (account.id)}
					<div
						class="flex items-center justify-between gap-4 rounded-lg border border-surface-200-800 bg-surface-100-900 p-4 transition-all hover:border-surface-300-700"
					>
						<div class="flex items-center gap-3">
							<div class="flex size-10 items-center justify-center rounded-lg bg-surface-200-800">
								<MailIcon class="size-5 opacity-60" />
							</div>
							<div>
								<div class="flex items-center gap-2">
									<p class="text-sm font-semibold">{account.username}</p>
									<span class="badge {getProviderColor(account.provider)} text-[10px]">
										{getProviderLabel(account.provider)}
									</span>
									{#if account.is_default}
										<span class="badge preset-filled-secondary-500 text-[10px]">Default</span>
									{/if}
								</div>
								<p class="mt-0.5 text-xs opacity-50">
									{account.host}:{account.port}
								</p>
							</div>
						</div>

						<div class="flex items-center gap-2">
							{#if deleteConfirmId === account.id}
								<span class="text-xs text-error-500">Are you sure?</span>
								<button
									type="button"
									class="btn preset-filled-error-500 btn-sm"
									onclick={() => deleteAccount(account.id)}
								>
									Yes, Delete
								</button>
								<button
									type="button"
									class="btn preset-tonal btn-sm"
									onclick={() => (deleteConfirmId = null)}
								>
									Cancel
								</button>
							{:else}
								<button
									type="button"
									class="btn-icon btn-icon-sm hover:preset-tonal-error"
									title="Remove account"
									onclick={() => (deleteConfirmId = account.id)}
								>
									<TrashIcon class="size-4" />
								</button>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<div
				class="flex flex-col items-center justify-center rounded-lg border border-dashed border-surface-300-700 p-10"
			>
				<MailIcon class="size-10 opacity-20" />
				<p class="mt-3 text-sm opacity-50">No email accounts connected yet.</p>
				<p class="mt-1 text-xs opacity-30">
					Add an account to start monitoring for application updates.
				</p>
			</div>
		{/if}
	</div>

	<!-- Add account form -->
	{#if showForm}
		<div class="card border border-primary-500/30 bg-surface-50-950 p-5">
			<h2 class="mb-4 flex items-center gap-2 text-sm font-bold">
				<PlusIcon class="size-4 text-primary-500" />
				Add Email Account
			</h2>

			<form
				onsubmit={(e) => {
					e.preventDefault();
					addAccount();
				}}
				class="space-y-5"
			>
				<!-- Provider + Connection -->
				<div class="grid gap-4 md:grid-cols-3">
					<label class="label">
						<span class="flex items-center gap-1.5 text-sm font-medium">
							<MailIcon class="size-3.5 opacity-50" />
							Provider
						</span>
						<select class="select mt-1" bind:value={formState.provider}>
							<option value="imap">IMAP (Generic)</option>
							<option value="gmail">Gmail</option>
							<option value="outlook">Outlook</option>
						</select>
					</label>

					<label class="label">
						<span class="flex items-center gap-1.5 text-sm font-medium">
							<ServerIcon class="size-3.5 opacity-50" />
							IMAP Host
						</span>
						<input
							type="text"
							class="mt-1 input"
							placeholder="imap.gmail.com"
							bind:value={formState.host}
							required
						/>
					</label>

					<label class="label">
						<span class="flex items-center gap-1.5 text-sm font-medium">
							<ServerIcon class="size-3.5 opacity-50" />
							Port
						</span>
						<input
							type="number"
							class="mt-1 input"
							placeholder="993"
							bind:value={formState.port}
							required
						/>
					</label>
				</div>

				<!-- Credentials -->
				<div class="grid gap-4 md:grid-cols-2">
					<label class="label">
						<span class="flex items-center gap-1.5 text-sm font-medium">
							<UserIcon class="size-3.5 opacity-50" />
							Username / Email
						</span>
						<input
							type="text"
							class="mt-1 input"
							placeholder="you@example.com"
							bind:value={formState.username}
							required
						/>
					</label>

					<label class="label">
						<span class="flex items-center gap-1.5 text-sm font-medium">
							<LockIcon class="size-3.5 opacity-50" />
							Password / App Password
						</span>
						<input
							type="password"
							class="mt-1 input"
							placeholder="••••••••"
							bind:value={formState.password}
							required
						/>
					</label>
				</div>

				<!-- Default switch -->
				<div class="flex items-center gap-3">
					<Switch
						checked={formState.isDefault}
						onCheckedChange={(e) => (formState.isDefault = e.checked)}
					>
						<Switch.Control>
							<Switch.Thumb />
						</Switch.Control>
						<Switch.Label>Set as default account</Switch.Label>
						<Switch.HiddenInput />
					</Switch>
				</div>

				<!-- Actions -->
				<div class="flex justify-end gap-2 border-t border-surface-200-800 pt-4">
					<button type="button" class="btn preset-tonal" onclick={() => (showForm = false)}>
						Cancel
					</button>
					<button type="submit" class="btn gap-1.5 preset-filled-primary-500" disabled={isAdding}>
						{#if isAdding}
							<span class="animate-spin">⏳</span>
							<span>Saving...</span>
						{:else}
							<CheckCircleIcon class="size-4" />
							<span>Save Account</span>
						{/if}
					</button>
				</div>
			</form>
		</div>
	{/if}
</div>
