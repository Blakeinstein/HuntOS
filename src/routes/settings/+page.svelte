<script lang="ts">
	import {
		MailIcon,
		GlobeIcon,
		ChevronRightIcon,
		SettingsIcon,
		ShieldIcon,
		BellIcon,
		FileTextIcon,
		WrenchIcon
	} from '@lucide/svelte';
	import { resolve } from '$app/paths';
</script>

<div class="mx-auto max-w-3xl space-y-6">
	<!-- Page header -->
	<div>
		<h1 class="h3 font-bold">Settings</h1>
		<p class="text-sm opacity-60">
			Configure email connections, job board automation, and preferences.
		</p>
	</div>

	<!-- Settings cards grid -->
	<div class="grid gap-4 md:grid-cols-2">
		<!-- Email connections -->
		<a
			href={resolve('/settings/email')}
			class="group flex items-start gap-4 card border border-surface-200-800 bg-surface-50-950 p-5 transition-all hover:border-primary-500 hover:shadow-md"
		>
			<div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-500/10">
				<MailIcon class="size-5 text-primary-500" />
			</div>
			<div class="min-w-0 flex-1">
				<div class="flex items-center justify-between">
					<h2 class="text-sm font-bold">Email Connections</h2>
					<ChevronRightIcon
						class="size-4 opacity-30 transition-transform group-hover:translate-x-0.5 group-hover:opacity-60"
					/>
				</div>
				<p class="mt-0.5 text-xs opacity-60">
					Connect your inbox to automatically detect application status updates from recruiters.
				</p>
			</div>
		</a>

		<!-- Resume format -->
		<a
			href={resolve('/settings/resume')}
			class="group flex items-start gap-4 card border border-surface-200-800 bg-surface-50-950 p-5 transition-all hover:border-primary-500 hover:shadow-md"
		>
			<div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-tertiary-500/10">
				<FileTextIcon class="size-5 text-tertiary-500" />
			</div>
			<div class="min-w-0 flex-1">
				<div class="flex items-center justify-between">
					<h2 class="text-sm font-bold">Resume Format</h2>
					<ChevronRightIcon
						class="size-4 opacity-30 transition-transform group-hover:translate-x-0.5 group-hover:opacity-60"
					/>
				</div>
				<p class="mt-0.5 text-xs opacity-60">
					Choose between Markdown + Handlebars templates or Typst (NNJR) for resume generation.
				</p>
			</div>
		</a>

		<!-- Job boards -->
		<a
			href={resolve('/settings/job-boards')}
			class="group flex items-start gap-4 card border border-surface-200-800 bg-surface-50-950 p-5 transition-all hover:border-primary-500 hover:shadow-md"
		>
			<div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary-500/10">
				<GlobeIcon class="size-5 text-secondary-500" />
			</div>
			<div class="min-w-0 flex-1">
				<div class="flex items-center justify-between">
					<h2 class="text-sm font-bold">Job Boards</h2>
					<ChevronRightIcon
						class="size-4 opacity-30 transition-transform group-hover:translate-x-0.5 group-hover:opacity-60"
					/>
				</div>
				<p class="mt-0.5 text-xs opacity-60">
					Configure automated job board searches and scheduling for finding new postings.
				</p>
			</div>
		</a>

		<!-- Notifications (placeholder) -->
		<div
			class="flex items-start gap-4 card border border-surface-200-800 bg-surface-50-950 p-5 opacity-50"
		>
			<div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-warning-500/10">
				<BellIcon class="size-5 text-warning-500" />
			</div>
			<div class="min-w-0 flex-1">
				<div class="flex items-center justify-between">
					<h2 class="text-sm font-bold">Notifications</h2>
					<span class="badge preset-tonal text-[10px]">Coming Soon</span>
				</div>
				<p class="mt-0.5 text-xs opacity-60">
					Configure how and when you receive alerts about application updates.
				</p>
			</div>
		</div>

		<!-- Security (placeholder) -->
		<div
			class="flex items-start gap-4 card border border-surface-200-800 bg-surface-50-950 p-5 opacity-50"
		>
			<div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-error-500/10">
				<ShieldIcon class="size-5 text-error-500" />
			</div>
			<div class="min-w-0 flex-1">
				<div class="flex items-center justify-between">
					<h2 class="text-sm font-bold">Security</h2>
					<span class="badge preset-tonal text-[10px]">Coming Soon</span>
				</div>
				<p class="mt-0.5 text-xs opacity-60">
					Manage credential encryption, session cookies, and API key storage.
				</p>
			</div>
		</div>

		<!-- Admin -->
		<a
			href={resolve('/settings/admin')}
			class="group flex items-start gap-4 card border border-surface-200-800 bg-surface-50-950 p-5 transition-all hover:border-warning-500 hover:shadow-md md:col-span-2"
		>
			<div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-warning-500/10">
				<WrenchIcon class="size-5 text-warning-500" />
			</div>
			<div class="min-w-0 flex-1">
				<div class="flex items-center justify-between">
					<h2 class="text-sm font-bold">Admin</h2>
					<ChevronRightIcon
						class="size-4 opacity-30 transition-transform group-hover:translate-x-0.5 group-hover:opacity-60"
					/>
				</div>
				<p class="mt-0.5 text-xs opacity-60">
					Inspect and mutate database tables, stream live server logs, and browse stored files
					(resumes, screenshots, user resources).
				</p>
			</div>
		</a>
	</div>

	<!-- Info section -->
	<div class="flex items-start gap-3 card border border-surface-200-800 bg-surface-50-950 p-4">
		<SettingsIcon class="mt-0.5 size-4 shrink-0 opacity-40" />
		<div>
			<p class="text-xs opacity-60">
				AutoApply is designed for a single user. All configuration and credentials are stored
				locally in your SQLite database. Make sure to secure your environment before storing
				sensitive information like email passwords or session cookies.
			</p>
		</div>
	</div>
</div>
