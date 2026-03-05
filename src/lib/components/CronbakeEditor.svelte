<script lang="ts">
	import {
		SaveIcon,
		RefreshCwIcon,
		AlertTriangleIcon,
		CheckIcon,
		Loader2Icon
	} from '@lucide/svelte';

	// ── State ──────────────────────────────────────────────────────────────────

	let rawJson = $state('');
	let loading = $state(false);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let saveSuccess = $state(false);
	let parseError = $state<string | null>(null);

	// ── Helpers ────────────────────────────────────────────────────────────────

	function validateJson(text: string): string | null {
		try {
			JSON.parse(text);
			return null;
		} catch (e) {
			return e instanceof Error ? e.message : 'Invalid JSON';
		}
	}

	function handleInput(e: Event) {
		const target = e.currentTarget as HTMLTextAreaElement;
		rawJson = target.value;
		parseError = validateJson(rawJson);
		saveSuccess = false;
	}

	// ── API ────────────────────────────────────────────────────────────────────

	async function load() {
		loading = true;
		error = null;
		saveSuccess = false;
		try {
			const res = await fetch('/api/admin/cronbake');
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				throw new Error((data as Record<string, string>).error ?? `HTTP ${res.status}`);
			}
			const data = await res.json();
			rawJson = JSON.stringify(data, null, 2);
			parseError = null;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load cronbake state';
		} finally {
			loading = false;
		}
	}

	async function save() {
		parseError = validateJson(rawJson);
		if (parseError) return;

		saving = true;
		error = null;
		saveSuccess = false;
		try {
			const res = await fetch('/api/admin/cronbake', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: rawJson
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error((data as Record<string, string>).error ?? `HTTP ${res.status}`);
			}
			saveSuccess = true;
			setTimeout(() => (saveSuccess = false), 3000);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save cronbake state';
		} finally {
			saving = false;
		}
	}

	// ── Lifecycle ──────────────────────────────────────────────────────────────

	$effect(() => {
		load();
	});
</script>

<div class="space-y-3">
	<!-- Toolbar -->
	<div class="flex items-center gap-2">
		<div class="flex-1">
			<p class="text-xs opacity-60">
				Direct editor for <code class="font-mono">data/cronbake-state.json</code>. Saving will
				restart the scheduler so the new state takes effect immediately. Use this to clear stale job
				entries or fix corrupted cron patterns.
			</p>
		</div>
		<button
			type="button"
			class="btn preset-tonal btn-sm"
			onclick={load}
			disabled={loading || saving}
			title="Reload from disk"
		>
			<RefreshCwIcon class="size-3.5 {loading ? 'animate-spin' : ''}" />
			Reload
		</button>
		<button
			type="button"
			class="btn preset-filled btn-sm"
			onclick={save}
			disabled={loading || saving || !!parseError || !rawJson.trim()}
			title="Save and restart scheduler"
		>
			{#if saving}
				<Loader2Icon class="size-3.5 animate-spin" />
				Saving…
			{:else if saveSuccess}
				<CheckIcon class="size-3.5" />
				Saved
			{:else}
				<SaveIcon class="size-3.5" />
				Save & Restart
			{/if}
		</button>
	</div>

	<!-- Error banner -->
	{#if error}
		<div
			class="flex items-start gap-2 rounded-lg border border-error-500/40 bg-error-500/10 px-3 py-2 text-sm text-error-500"
		>
			<AlertTriangleIcon class="mt-0.5 size-4 shrink-0" />
			<span>{error}</span>
		</div>
	{/if}

	<!-- Parse error banner -->
	{#if parseError}
		<div
			class="flex items-start gap-2 rounded-lg border border-warning-500/40 bg-warning-500/10 px-3 py-2 text-sm text-warning-500"
		>
			<AlertTriangleIcon class="mt-0.5 size-4 shrink-0" />
			<span class="font-mono">{parseError}</span>
		</div>
	{/if}

	<!-- JSON editor -->
	{#if loading}
		<div class="flex items-center gap-2 py-8 opacity-50">
			<Loader2Icon class="size-4 animate-spin" />
			<span class="text-sm">Loading cronbake state…</span>
		</div>
	{:else}
		<div
			class="overflow-hidden rounded-xl border {parseError
				? 'border-warning-500/60'
				: 'border-surface-200-800'}"
		>
			<div
				class="flex items-center justify-between border-b border-surface-200-800 bg-surface-50-950 px-3 py-1.5"
			>
				<span class="font-mono text-xs opacity-50">cronbake-state.json</span>
				{#if !parseError && rawJson.trim()}
					<span class="text-[10px] text-success-500 opacity-80">✓ valid JSON</span>
				{/if}
			</div>
			<textarea
				class="w-full resize-none bg-surface-950 p-3 font-mono text-xs leading-relaxed focus:outline-none"
				style="min-height: 480px; tab-size: 2;"
				spellcheck="false"
				autocomplete="off"
				autocapitalize="off"
				value={rawJson}
				oninput={handleInput}
				onkeydown={(e) => {
					// Allow Tab to insert spaces instead of moving focus
					if (e.key === 'Tab') {
						e.preventDefault();
						const el = e.currentTarget as HTMLTextAreaElement;
						const start = el.selectionStart;
						const end = el.selectionEnd;
						const newVal = rawJson.slice(0, start) + '  ' + rawJson.slice(end);
						rawJson = newVal;
						// Restore cursor position after the inserted spaces
						requestAnimationFrame(() => {
							el.selectionStart = el.selectionEnd = start + 2;
						});
					}
				}}
			></textarea>
		</div>
		<p class="text-right text-[10px] opacity-30">
			{rawJson.split('\n').length} lines · {new Blob([rawJson]).size} bytes
		</p>
	{/if}
</div>
