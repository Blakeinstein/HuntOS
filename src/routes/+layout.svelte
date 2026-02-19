<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/stores';
	import { AppBar, Navigation } from '@skeletonlabs/skeleton-svelte';
	import {
		KanbanIcon,
		UserIcon,
		SettingsIcon,
		ScrollTextIcon,
		BriefcaseIcon,
		PanelLeftCloseIcon,
		PanelLeftOpenIcon,
		FileTextIcon
	} from '@lucide/svelte';

	let { children } = $props();

	let sidebarCollapsed = $state(false);

	const navLinks = [
		{ label: 'Roadmap', href: '/applications', icon: KanbanIcon },
		{ label: 'Profiles', href: '/profiles', icon: UserIcon },
		{ label: 'Resume', href: '/resume', icon: FileTextIcon },
		{ label: 'Audit Log', href: '/audit', icon: ScrollTextIcon },
		{ label: 'Settings', href: '/settings', icon: SettingsIcon }
	];

	const currentPath = $derived($page.url.pathname);

	function isActive(href: string): boolean {
		if (href === '/applications') {
			return currentPath === '/' || currentPath.startsWith('/applications');
		}
		return currentPath.startsWith(href);
	}
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="grid h-dvh grid-cols-[auto_1fr] grid-rows-[auto_1fr] overflow-hidden">
	<!-- App Bar -->
	<header class="col-span-2 border-b border-surface-200-800 bg-surface-50-950">
		<AppBar>
			<AppBar.Toolbar class="grid-cols-[auto_1fr_auto]">
				<AppBar.Lead>
					<button
						type="button"
						class="btn-icon hover:preset-tonal"
						onclick={() => (sidebarCollapsed = !sidebarCollapsed)}
						aria-label="Toggle sidebar"
					>
						{#if sidebarCollapsed}
							<PanelLeftOpenIcon class="size-5" />
						{:else}
							<PanelLeftCloseIcon class="size-5" />
						{/if}
					</button>
				</AppBar.Lead>
				<AppBar.Headline>
					<a href="/applications" class="flex items-center gap-2">
						<BriefcaseIcon class="size-6 text-primary-500" />
						<span class="text-xl font-bold">AutoApply</span>
					</a>
				</AppBar.Headline>
				<AppBar.Trail>
					<span class="badge preset-filled-surface-500 text-xs">v0.1</span>
				</AppBar.Trail>
			</AppBar.Toolbar>
		</AppBar>
	</header>

	<!-- Sidebar Navigation -->
	<aside
		class="overflow-y-auto border-r border-surface-200-800 bg-surface-50-950 transition-all duration-200"
		class:w-48={!sidebarCollapsed}
		class:w-16={sidebarCollapsed}
	>
		<Navigation
			layout={sidebarCollapsed ? 'rail' : 'sidebar'}
			class="grid h-full grid-rows-[1fr_auto] gap-4 py-4"
		>
			<Navigation.Content>
				<Navigation.Menu>
					{#each navLinks as link (link.href)}
						{@const Icon = link.icon}
						{@const active = isActive(link.href)}
						<Navigation.TriggerAnchor
							href={link.href}
							class={active ? 'preset-tonal-primary' : ''}
							title={link.label}
							aria-label={link.label}
							aria-current={active ? 'page' : undefined}
						>
							<Icon class={sidebarCollapsed ? 'size-5' : 'size-4'} />
							<Navigation.TriggerText>{link.label}</Navigation.TriggerText>
						</Navigation.TriggerAnchor>
					{/each}
				</Navigation.Menu>
			</Navigation.Content>
		</Navigation>
	</aside>

	<!-- Main Content -->
	<main class="overflow-y-auto bg-surface-100-900 p-6">
		{@render children()}
	</main>
</div>
