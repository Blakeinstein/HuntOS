<script lang="ts">
	import { resolve } from '$app/paths';
	import { Switch } from '@skeletonlabs/skeleton-svelte';
	import {
		ArrowLeftIcon,
		BotIcon,
		ClockIcon,
		GlobeIcon,
		MailIcon,
		TrashIcon,
		ZapIcon,
		RefreshCwIcon,
		CheckCircleIcon,
		AlertCircleIcon,
		InfoIcon,
		SettingsIcon,
		ActivityIcon,
		ChevronRightIcon
	} from '@lucide/svelte';

	let { data } = $props();

	// ── Server data lifted into $state so mutations are always reactive ──────
	// $state() here intentionally captures the initial prop value as a snapshot.
	// We update these manually after a successful save instead of re-deriving
	// from `data`, which is a prop and doesn't trigger reactivity on sub-mutations.

	let serverSettings = $state.raw(data.settings);
	let serverScheduler = $state.raw(data.scheduler);

	// ── Form state (local overrides — null means "use server value") ─

	let _autoApplyEnabled = $state<boolean | null>(null);
	let _autoApplyCron = $state<string | null>(null);
	let _autoApplyBatchSize = $state<string | null>(null);
	let _scraperEnabled = $state<boolean | null>(null);
	let _auditCleanupEnabled = $state<boolean | null>(null);
	let _auditCleanupCron = $state<string | null>(null);

	// Effective form values: local override ?? server value
	let autoApplyEnabled = $derived(_autoApplyEnabled ?? serverSettings.autoApplyEnabled);
	let autoApplyCron = $derived(_autoApplyCron ?? serverSettings.autoApplyCron);
	let autoApplyBatchSize = $derived(
		_autoApplyBatchSize ?? String(serverSettings.autoApplyBatchSize)
	);
	let scraperEnabled = $derived(_scraperEnabled ?? serverSettings.scraperEnabled);
	let auditCleanupEnabled = $derived(_auditCleanupEnabled ?? serverSettings.auditCleanupEnabled);
	let auditCleanupCron = $derived(_auditCleanupCron ?? serverSettings.auditCleanupCron);

	let isSaving = $state(false);
	let saveResult = $state<{ ok: boolean; message: string } | null>(null);
	let schedulerJobs = $derived(serverScheduler.jobs ?? []);
	let schedulerInitialized = $derived(serverScheduler.initialized);

	// Track unsaved changes
	let hasChanges = $derived(
		_autoApplyEnabled !== null ||
			_autoApplyCron !== null ||
			_autoApplyBatchSize !== null ||
			_scraperEnabled !== null ||
			_auditCleanupEnabled !== null ||
			_auditCleanupCron !== null
	);

	/** Clear all local overrides (resets form to server state). */
	function clearOverrides() {
		_autoApplyEnabled = null;
		_autoApplyCron = null;
		_autoApplyBatchSize = null;
		_scraperEnabled = null;
		_auditCleanupEnabled = null;
		_auditCleanupCron = null;
	}

	// ── Cron presets ────────────────────────────────────────────────

	const autoApplyCronPresets = [
		{ value: '0 */2 * * * *', label: 'Every 2 minutes' },
		{ value: '0 */5 * * * *', label: 'Every 5 minutes' },
		{ value: '0 */10 * * * *', label: 'Every 10 minutes' },
		{ value: '0 */15 * * * *', label: 'Every 15 minutes' },
		{ value: '0 */30 * * * *', label: 'Every 30 minutes' },
		{ value: '0 0 * * * *', label: 'Every hour' }
	];

	const auditCleanupCronPresets = [
		{ value: '0 0 3 * * *', label: 'Daily at 3:00 AM' },
		{ value: '0 0 0 * * *', label: 'Daily at midnight' },
		{ value: '0 0 0 * * 0', label: 'Weekly (Sunday midnight)' },
		{ value: '0 0 0 1 * *', label: 'Monthly (1st at midnight)' }
	];

	const batchSizeOptions = [
		{ value: '1', label: '1 application' },
		{ value: '2', label: '2 applications' },
		{ value: '3', label: '3 applications' },
		{ value: '5', label: '5 applications' },
		{ value: '8', label: '8 applications' },
		{ value: '10', label: '10 applications' }
	];

	// ── Save ────────────────────────────────────────────────────────

	async function saveSettings() {
		isSaving = true;
		saveResult = null;

		try {
			const res = await fetch('/api/settings/automation', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					autoApplyEnabled,
					autoApplyCron: autoApplyCron.trim(),
					autoApplyBatchSize: Number(autoApplyBatchSize),
					scraperEnabled,
					auditCleanupEnabled,
					auditCleanupCron: auditCleanupCron.trim()
				})
			});

			const result = await res.json();

			if (!res.ok) {
				saveResult = {
					ok: false,
					message: result.error || 'Failed to save settings'
				};
				return;
			}

			const changedCount = result.reconfigured?.length ?? 0;
			saveResult = {
				ok: true,
				message:
					changedCount > 0
						? `Settings saved — ${changedCount} job(s) reconfigured`
						: 'Settings saved'
			};

			// Update $state so derived values and hasChanges recalculate immediately
			if (result.settings) {
				serverSettings = result.settings;
			}

			// Clear local overrides — form now reads the fresh serverSettings
			clearOverrides();

			// Refresh scheduler job statuses
			await refreshSchedulerStatus();
		} catch (err) {
			saveResult = {
				ok: false,
				message: err instanceof Error ? err.message : 'Network error'
			};
		} finally {
			isSaving = false;

			if (saveResult?.ok) {
				setTimeout(() => {
					saveResult = null;
				}, 4000);
			}
		}
	}

	// ── Scheduler status ────────────────────────────────────────────

	async function refreshSchedulerStatus() {
		try {
			const res = await fetch('/api/settings/automation');
			const result = await res.json();
			if (result.scheduler) {
				serverScheduler = result.scheduler;
			}
		} catch {
			// Silently ignore — the status will be stale but that's fine
		}
	}

	function formatJobStatus(status: string): { label: string; color: string } {
		switch (status) {
			case 'running':
				return { label: 'Running', color: 'text-success-500' };
			case 'paused':
				return { label: 'Paused', color: 'text-warning-500' };
			case 'stopped':
				return { label: 'Stopped', color: 'text-surface-500' };
			case 'idle':
				return { label: 'Idle', color: 'text-primary-500' };
			default:
				return { label: status, color: 'text-surface-500' };
		}
	}

	function formatDate(dateStr: string | null): string {
		if (!dateStr) return 'Never';
		const date = new Date(dateStr);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const isFuture = diffMs < 0;
		const absDiffMs = Math.abs(diffMs);
		const diffMins = Math.floor(absDiffMs / 60000);

		if (diffMins < 1) return isFuture ? 'In < 1m' : 'Just now';
		if (diffMins < 60) return isFuture ? `In ${diffMins}m` : `${diffMins}m ago`;
		const diffHours = Math.floor(diffMins / 60);
		if (diffHours < 24) return isFuture ? `In ${diffHours}h` : `${diffHours}h ago`;
		const diffDays = Math.floor(diffHours / 24);
		return isFuture ? `In ${diffDays}d` : `${diffDays}d ago`;
	}

	function describeCron(cron: string): string {
		const parts = cron.trim().split(/\s+/);
		if (parts.length < 5) return cron;

		// Support both 5-field (min h d m dow) and 6-field (sec min h d m dow) cron
		// For 6-field, skip the leading seconds field.
		const offset = parts.length >= 6 ? 1 : 0;
		const minute = parts[offset];
		const hour = parts[offset + 1];
		const dayOfMonth = parts[offset + 2];
		const month = parts[offset + 3];
		const dayOfWeek = parts[offset + 4];

		// Every N minutes
		if (minute?.startsWith('*/') && hour === '*' && dayOfMonth === '*') {
			const n = minute.slice(2);
			return `Every ${n} minute${n === '1' ? '' : 's'}`;
		}

		// Every N hours
		if (minute === '0' && hour?.startsWith('*/') && dayOfMonth === '*') {
			const n = hour.slice(2);
			return `Every ${n} hour${n === '1' ? '' : 's'}`;
		}

		// Top of every hour
		if (minute === '0' && hour === '*' && dayOfMonth === '*') {
			return 'Every hour';
		}

		// Daily at specific time
		if (
			minute?.match(/^\d+$/) &&
			hour?.match(/^\d+$/) &&
			dayOfMonth === '*' &&
			month === '*' &&
			dayOfWeek === '*'
		) {
			const h = hour.padStart(2, '0');
			const m = minute.padStart(2, '0');
			return `Daily at ${h}:${m}`;
		}

		// Weekly
		if (dayOfMonth === '*' && month === '*' && dayOfWeek?.match(/^\d$/)) {
			const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
			const day = days[Number(dayOfWeek)] ?? dayOfWeek;
			return `Weekly on ${day}`;
		}

		// Monthly
		if (dayOfMonth?.match(/^\d+$/) && month === '*') {
			return `Monthly on day ${dayOfMonth}`;
		}

		return cron;
	}

	function handleCronSelect(
		presets: { value: string; label: string }[],
		currentValue: string,
		setter: (v: string) => void
	) {
		return (e: Event) => {
			const target = e.target as HTMLSelectElement;
			const val = target.value;
			if (val === '__custom__') return;
			setter(val);
		};
	}

	function isPresetMatch(presets: { value: string }[], value: string): boolean {
		const trimmed = value.trim();
		return presets.some((p) => p.value === trimmed);
	}
</script>

<div class="mx-auto max-w-3xl space-y-6">
	<!-- Page header -->
	<div class="flex items-start justify-between gap-4">
		<div class="flex items-start gap-3">
			<a
				href={resolve('/settings')}
				class="mt-1 btn-icon btn-icon-sm preset-tonal"
				aria-label="Back to settings"
			>
				<ArrowLeftIcon class="size-4" />
			</a>
			<div>
				<h1 class="h3 font-bold">Automation</h1>
				<p class="text-sm opacity-60">
					Configure scheduled jobs, auto-apply behavior, and cron patterns.
				</p>
			</div>
		</div>

		<button
			type="button"
			class="btn gap-2 preset-filled-primary-500"
			disabled={isSaving || !hasChanges}
			onclick={saveSettings}
		>
			{#if isSaving}
				<span class="animate-spin">⏳</span>
				<span>Saving…</span>
			{:else}
				<CheckCircleIcon class="size-4" />
				<span>Save Changes</span>
			{/if}
		</button>
	</div>

	<!-- Save result toast -->
	{#if saveResult}
		<div
			class="flex items-center gap-2 rounded-lg border p-3 text-sm {saveResult.ok
				? 'border-success-500/30 bg-success-500/10 text-success-500'
				: 'border-error-500/30 bg-error-500/10 text-error-500'}"
		>
			{#if saveResult.ok}
				<CheckCircleIcon class="size-4 shrink-0" />
			{:else}
				<AlertCircleIcon class="size-4 shrink-0" />
			{/if}
			<span>{saveResult.message}</span>
		</div>
	{/if}

	<!-- ═══════════════════════════════════════════════════════════════
	     AUTO-APPLY SECTION
	     ═══════════════════════════════════════════════════════════════ -->
	<div class="card border border-surface-200-800 bg-surface-50-950 p-5">
		<div class="mb-4 flex items-center justify-between">
			<h2 class="flex items-center gap-2 text-sm font-bold">
				<BotIcon class="size-4 text-primary-500" />
				Auto-Apply
			</h2>
			<Switch checked={autoApplyEnabled} onCheckedChange={(e) => (_autoApplyEnabled = e.checked)}>
				<Switch.Control>
					<Switch.Thumb />
				</Switch.Control>
				<Switch.HiddenInput />
			</Switch>
		</div>

		<div
			class="mb-4 flex items-start gap-2 rounded-lg border border-primary-500/20 bg-primary-500/5 p-3"
		>
			<InfoIcon class="mt-0.5 size-4 shrink-0 text-primary-500" />
			<p class="text-xs opacity-70">
				When enabled, the scheduler automatically picks applications from the <strong
					>Backlog</strong
				>
				swimlane (oldest first) and runs the full apply pipeline (Research → Resume → Apply) on each one.
				Configure the interval and batch size below.
			</p>
		</div>

		<div
			class="grid gap-4 transition-opacity md:grid-cols-2"
			class:opacity-50={!autoApplyEnabled}
			class:pointer-events-none={!autoApplyEnabled}
		>
			<!-- Cron pattern -->
			<label class="label">
				<span class="flex items-center gap-1.5 text-sm font-medium">
					<ClockIcon class="size-3.5 opacity-50" />
					Schedule
				</span>
				<select
					class="select mt-1"
					value={isPresetMatch(autoApplyCronPresets, autoApplyCron)
						? autoApplyCron.trim()
						: '__custom__'}
					onchange={handleCronSelect(
						autoApplyCronPresets,
						autoApplyCron,
						(v) => (_autoApplyCron = v)
					)}
				>
					{#each autoApplyCronPresets as preset (preset.value)}
						<option value={preset.value}>{preset.label}</option>
					{/each}
					<option value="__custom__">Custom…</option>
				</select>
				{#if !isPresetMatch(autoApplyCronPresets, autoApplyCron)}
					<input
						type="text"
						class="mt-1 input"
						placeholder="0 */5 * * * *"
						value={autoApplyCron}
						oninput={(e) => (_autoApplyCron = e.currentTarget.value)}
					/>
				{/if}
				<p class="mt-0.5 text-xs opacity-40">
					Current: <code class="font-mono text-[10px]">{autoApplyCron}</code> — {describeCron(
						autoApplyCron
					)}
				</p>
			</label>

			<!-- Batch size -->
			<label class="label">
				<span class="flex items-center gap-1.5 text-sm font-medium">
					<ZapIcon class="size-3.5 opacity-50" />
					Batch Size
				</span>
				<select
					class="select mt-1"
					value={autoApplyBatchSize}
					onchange={(e) => (_autoApplyBatchSize = e.currentTarget.value)}
				>
					{#each batchSizeOptions as opt (opt.value)}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
				<p class="mt-0.5 text-xs opacity-40">Number of Backlog applications to process per tick.</p>
			</label>
		</div>
	</div>

	<!-- ═══════════════════════════════════════════════════════════════
	     SCRAPER SCHEDULE
	     ═══════════════════════════════════════════════════════════════ -->
	<div class="card border border-surface-200-800 bg-surface-50-950 p-5">
		<div class="mb-4 flex items-center justify-between">
			<h2 class="flex items-center gap-2 text-sm font-bold">
				<GlobeIcon class="size-4 text-secondary-500" />
				Job Board Scraper
			</h2>
			<Switch checked={scraperEnabled} onCheckedChange={(e) => (_scraperEnabled = e.checked)}>
				<Switch.Control>
					<Switch.Thumb />
				</Switch.Control>
				<Switch.HiddenInput />
			</Switch>
		</div>

		<div
			class="space-y-4 transition-opacity"
			class:opacity-50={!scraperEnabled}
			class:pointer-events-none={!scraperEnabled}
		>
			<!-- Per-board interval explanation -->
			<div
				class="flex items-start gap-2 rounded-lg border border-secondary-500/20 bg-secondary-500/5 p-3"
			>
				<InfoIcon class="mt-0.5 size-4 shrink-0 text-secondary-500" />
				<p class="text-xs opacity-70">
					Each board has its own check interval configured on the Job Boards page. The scheduler
					automatically checks for due boards every few minutes and scrapes only those whose
					interval has elapsed.
				</p>
			</div>

			<a
				href={resolve('/settings/job-boards')}
				class="group flex items-center gap-3 rounded-lg border border-surface-200-800 bg-surface-100-900 p-3 transition-all hover:border-secondary-500 hover:shadow-sm"
			>
				<div
					class="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary-500/10"
				>
					<GlobeIcon class="size-4 text-secondary-500" />
				</div>
				<div class="min-w-0 flex-1">
					<p class="text-sm font-medium">Job Boards Settings</p>
					<p class="text-xs opacity-50">Add boards, configure per-board scrape intervals</p>
				</div>
				<ChevronRightIcon
					class="size-4 opacity-30 transition-transform group-hover:translate-x-0.5 group-hover:opacity-60"
				/>
			</a>
		</div>
	</div>

	<!-- ═══════════════════════════════════════════════════════════════
	     EMAIL SYNC SCHEDULE — COMING SOON
	     ═══════════════════════════════════════════════════════════════ -->
	<div class="card border border-surface-200-800 bg-surface-50-950 p-5 opacity-50">
		<div class="flex items-center justify-between">
			<h2 class="flex items-center gap-2 text-sm font-bold">
				<MailIcon class="size-4 text-tertiary-500" />
				Email Sync Schedule
			</h2>
			<span class="badge preset-tonal text-[10px]">Coming Soon</span>
		</div>
		<p class="mt-2 text-xs opacity-60">
			Periodically sync configured email accounts to detect application status updates from
			recruiters. Email connection settings and sync schedule will be configurable here once email
			integration is available.
		</p>
	</div>

	<!-- ═══════════════════════════════════════════════════════════════
	     AUDIT CLEANUP SCHEDULE
	     ═══════════════════════════════════════════════════════════════ -->
	<div class="card border border-surface-200-800 bg-surface-50-950 p-5">
		<div class="mb-4 flex items-center justify-between">
			<h2 class="flex items-center gap-2 text-sm font-bold">
				<TrashIcon class="size-4 text-warning-500" />
				Audit Log Cleanup
			</h2>
			<Switch
				checked={auditCleanupEnabled}
				onCheckedChange={(e) => (_auditCleanupEnabled = e.checked)}
			>
				<Switch.Control>
					<Switch.Thumb />
				</Switch.Control>
				<Switch.HiddenInput />
			</Switch>
		</div>

		<div
			class="space-y-4 transition-opacity"
			class:opacity-50={!auditCleanupEnabled}
			class:pointer-events-none={!auditCleanupEnabled}
		>
			<label class="label">
				<span class="flex items-center gap-1.5 text-sm font-medium">
					<ClockIcon class="size-3.5 opacity-50" />
					Cleanup Interval
				</span>
				<select
					class="select mt-1"
					value={isPresetMatch(auditCleanupCronPresets, auditCleanupCron)
						? auditCleanupCron.trim()
						: '__custom__'}
					onchange={handleCronSelect(
						auditCleanupCronPresets,
						auditCleanupCron,
						(v) => (_auditCleanupCron = v)
					)}
				>
					{#each auditCleanupCronPresets as preset (preset.value)}
						<option value={preset.value}>{preset.label}</option>
					{/each}
					<option value="__custom__">Custom…</option>
				</select>
				{#if !isPresetMatch(auditCleanupCronPresets, auditCleanupCron)}
					<input
						type="text"
						class="mt-1 input"
						placeholder="0 0 3 * * *"
						value={auditCleanupCron}
						oninput={(e) => (_auditCleanupCron = e.currentTarget.value)}
					/>
				{/if}
				<p class="mt-0.5 text-xs opacity-40">
					Current: <code class="font-mono text-[10px]">{auditCleanupCron}</code> — {describeCron(
						auditCleanupCron
					)}
				</p>
			</label>

			<p class="text-xs opacity-50">
				Removes audit log entries older than 90 days. Keeps the database lean and the admin log
				viewer fast.
			</p>
		</div>
	</div>

	<!-- ═══════════════════════════════════════════════════════════════
	     SCHEDULER STATUS
	     ═══════════════════════════════════════════════════════════════ -->
	<div class="card border border-surface-200-800 bg-surface-50-950 p-5">
		<div class="mb-4 flex items-center justify-between">
			<h2 class="flex items-center gap-2 text-sm font-bold">
				<ActivityIcon class="size-4 text-success-500" />
				Scheduler Status
				{#if schedulerInitialized}
					<span class="badge preset-filled-success-500 text-[10px]">Active</span>
				{:else}
					<span class="badge preset-filled-surface-500 text-[10px]">Not initialized</span>
				{/if}
			</h2>
			<button
				type="button"
				class="btn gap-1.5 preset-tonal btn-sm"
				onclick={refreshSchedulerStatus}
			>
				<RefreshCwIcon class="size-3.5" />
				<span>Refresh</span>
			</button>
		</div>

		{#if schedulerJobs.length > 0}
			<div class="space-y-2">
				{#each schedulerJobs as job (job.name)}
					{@const statusInfo = formatJobStatus(job.status)}
					<div
						class="flex items-center justify-between rounded-lg border border-surface-200-800 bg-surface-100-900 px-4 py-3"
					>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="text-sm font-medium">{job.name}</span>
								<span class="text-xs font-medium {statusInfo.color}">
									{statusInfo.label}
								</span>
							</div>
							<div class="mt-1 flex flex-wrap items-center gap-3 text-[11px] opacity-50">
								<span class="inline-flex items-center gap-1">
									<ClockIcon class="size-3" />
									Last: {formatDate(job.lastExecution)}
								</span>
								<span class="inline-flex items-center gap-1">
									<RefreshCwIcon class="size-3" />
									Next: {formatDate(job.nextExecution)}
								</span>
								{#if job.metrics}
									<span>
										{job.metrics.totalExecutions} runs ({job.metrics.successfulExecutions} ok, {job
											.metrics.failedExecutions} failed)
									</span>
									{#if job.metrics.averageExecutionTime > 0}
										<span>
											Avg: {(job.metrics.averageExecutionTime / 1000).toFixed(1)}s
										</span>
									{/if}
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<div
				class="flex flex-col items-center justify-center rounded-lg border border-dashed border-surface-300-700 p-8"
			>
				<SettingsIcon class="size-8 opacity-20" />
				<p class="mt-2 text-sm opacity-50">No scheduler jobs registered yet.</p>
				<p class="mt-1 text-xs opacity-30">Jobs are registered when the server starts.</p>
			</div>
		{/if}
	</div>

	<!-- Info footer -->
	<div class="flex items-start gap-3 card border border-surface-200-800 bg-surface-50-950 p-4">
		<InfoIcon class="mt-0.5 size-4 shrink-0 opacity-40" />
		<div>
			<p class="text-xs opacity-60">
				All schedules use cronbake 6-field syntax (<code class="font-mono text-[10px]"
					>sec min hour day month weekday</code
				>). Changes take effect immediately after saving — running jobs will finish their current
				execution before using the new schedule. The scheduler persists state to
				<code class="font-mono text-[10px]">data/cronbake-state.json</code>.
			</p>
		</div>
	</div>
</div>
