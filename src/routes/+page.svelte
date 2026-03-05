<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		UserIcon,
		FileTextIcon,
		GlobeIcon,
		ScrollTextIcon,
		KanbanIcon,
		CheckCircleIcon,
		ArrowRightIcon,
		SparklesIcon,
		RocketIcon,
		ZapIcon,
		TrendingUpIcon,
		ChevronRightIcon,
		BotIcon
	} from '@lucide/svelte';

	let { data } = $props();

	const completeness = $derived(data.completeness ?? 0);
	const incompleteFields = $derived(data.incompleteFields ?? []);
	const profileName = $derived(data.profileName ?? '');
	const totalJobBoards = $derived(data.totalJobBoards ?? 0);
	const enabledJobBoards = $derived(data.enabledJobBoards ?? 0);
	const totalApplications = $derived(data.totalApplications ?? 0);
	const totalResumes = $derived(data.totalResumes ?? 0);
	const totalAuditLogs = $derived(data.totalAuditLogs ?? 0);

	// ── Onboarding step resolution ───────────────────────────────────────
	const profileDone = $derived(completeness >= 60);
	const jobBoardsDone = $derived(enabledJobBoards > 0);
	const readyToGo = $derived(profileDone && jobBoardsDone);

	const currentStep = $derived(!profileDone ? 1 : !jobBoardsDone ? 2 : 2);

	const greeting = $derived(
		profileName ? `Welcome back, ${profileName.split(' ')[0]}` : 'Welcome to HuntOS'
	);

	// ── Stats cards ──────────────────────────────────────────────────────
	const stats = $derived([
		{
			label: 'Applications',
			value: totalApplications,
			icon: KanbanIcon,
			href: '/applications',
			color: 'text-primary-500',
			bg: 'bg-primary-500/10'
		},
		{
			label: 'Resumes',
			value: totalResumes,
			icon: FileTextIcon,
			href: '/resume',
			color: 'text-secondary-500',
			bg: 'bg-secondary-500/10'
		},
		{
			label: 'Job Boards',
			value: `${enabledJobBoards}/${totalJobBoards}`,
			icon: GlobeIcon,
			href: '/settings/job-boards',
			color: 'text-tertiary-500',
			bg: 'bg-tertiary-500/10'
		},
		{
			label: 'Audit Logs',
			value: totalAuditLogs,
			icon: ScrollTextIcon,
			href: '/audit',
			color: 'text-warning-500',
			bg: 'bg-warning-500/10'
		}
	]);

	const onboardingSteps = $derived([
		{
			step: 1,
			title: 'Set up your profile',
			description:
				'Tell HuntOS about yourself — skills, experience, preferences. This powers resume generation and smart applications.',
			href: '/profiles',
			cta: completeness > 0 ? 'Continue profile' : 'Get started',
			done: profileDone,
			icon: UserIcon,
			detail: `${Math.round(completeness)}% complete${incompleteFields.length > 0 ? ` · ${incompleteFields.length} fields remaining` : ''}`
		},
		{
			step: 2,
			title: 'Configure job boards',
			description:
				'Connect to job boards so HuntOS can automatically discover and scrape relevant listings for you.',
			href: '/settings/job-boards',
			cta: totalJobBoards > 0 ? 'Manage boards' : 'Add a job board',
			done: jobBoardsDone,
			icon: GlobeIcon,
			detail: jobBoardsDone
				? `${enabledJobBoards} board${enabledJobBoards !== 1 ? 's' : ''} active`
				: 'No boards configured yet'
		}
	]);
</script>

<div class="mx-auto max-w-5xl space-y-8">
	<!-- ─── Hero ──────────────────────────────────────────────────────── -->
	<section
		class="relative overflow-hidden rounded-2xl border border-surface-200-800 bg-surface-50-950 p-8 md:p-10"
	>
		<!-- Decorative gradient blobs -->
		<div
			class="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-primary-500/10 blur-3xl"
		></div>
		<div
			class="pointer-events-none absolute -bottom-16 -left-16 size-56 rounded-full bg-secondary-500/8 blur-3xl"
		></div>

		<div class="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
			<div class="space-y-3">
				<div class="flex items-center gap-2">
					<img src="/logo.svg" alt="HuntOS" class="size-12" />
					<span class="badge preset-filled-primary-500 text-xs font-semibold">v0.1</span>
				</div>
				<h1 class="h2 font-extrabold tracking-tight">
					{greeting}
				</h1>
				<p class="max-w-md text-sm leading-relaxed opacity-60">
					Your AI-powered job application assistant. Set up your profile, connect job boards, and
					let HuntOS handle the heavy lifting.
				</p>
			</div>

			<!-- Quick-action buttons -->
			<div class="flex flex-wrap gap-2">
				{#if !profileDone}
					<a
						href={resolve('/profiles')}
						class="btn gap-2 preset-filled-primary-500 text-sm font-semibold"
					>
						<SparklesIcon class="size-4" />
						Set up profile
					</a>
				{:else if !jobBoardsDone}
					<a
						href={resolve('/settings/job-boards')}
						class="btn gap-2 preset-filled-primary-500 text-sm font-semibold"
					>
						<GlobeIcon class="size-4" />
						Add job board
					</a>
				{:else}
					<a
						href={resolve('/applications')}
						class="btn gap-2 preset-filled-primary-500 text-sm font-semibold"
					>
						<KanbanIcon class="size-4" />
						View applications
					</a>
				{/if}
				<a href={resolve('/resume')} class="btn gap-2 preset-tonal text-sm font-semibold">
					<FileTextIcon class="size-4" />
					Resumes
				</a>
			</div>
		</div>
	</section>

	<!-- ─── Stats strip ──────────────────────────────────────────────── -->
	<section class="grid grid-cols-2 gap-3 md:grid-cols-4">
		{#each stats as stat (stat.label)}
			{@const Icon = stat.icon}
			<a
				href={stat.href}
				class="group flex items-center gap-3 card border border-surface-200-800 bg-surface-50-950 p-4 transition-all hover:border-primary-500/50 hover:shadow-md"
			>
				<div class="flex size-10 shrink-0 items-center justify-center rounded-lg {stat.bg}">
					<Icon class="size-5 {stat.color}" />
				</div>
				<div class="min-w-0">
					<p class="text-xl leading-none font-extrabold tabular-nums">{stat.value}</p>
					<p class="mt-0.5 text-[11px] font-medium tracking-wide uppercase opacity-50">
						{stat.label}
					</p>
				</div>
				<ChevronRightIcon
					class="ml-auto size-4 shrink-0 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-40"
				/>
			</a>
		{/each}
	</section>

	<!-- ─── Onboarding Steps (2-step) ────────────────────────────────── -->
	<section class="space-y-4">
		<div class="flex items-center gap-3">
			<ZapIcon class="size-5 text-primary-500" />
			<h2 class="text-lg font-bold">Getting started</h2>
			{#if readyToGo}
				<span class="badge preset-filled-success-500 text-[10px] font-semibold">All set!</span>
			{:else}
				<span class="badge preset-tonal text-[10px] font-semibold">
					Step {currentStep} of 2
				</span>
			{/if}
		</div>

		<!-- Progress bar -->
		<div class="relative h-2 overflow-hidden rounded-full bg-surface-200-800">
			<div
				class="absolute inset-y-0 left-0 rounded-full bg-linear-to-r from-primary-500 to-secondary-500 transition-all duration-700 ease-out"
				style="width: {readyToGo
					? 100
					: currentStep === 1
						? Math.max(5, completeness * 0.5)
						: 50 + (enabledJobBoards > 0 ? 50 : 0)}%"
			></div>
		</div>

		<!-- Step cards -->
		<div class="grid gap-3 md:grid-cols-2">
			{#each onboardingSteps as item (item.step)}
				{@const Icon = item.icon}
				{@const isCurrent = item.step === currentStep && !readyToGo}
				{@const isLocked = item.step > currentStep && !item.done && !readyToGo}
				<div
					class="relative flex flex-col gap-4 rounded-xl border p-5 transition-all duration-300 {isCurrent
						? 'border-primary-500/50 bg-primary-500/5 shadow-lg shadow-primary-500/5'
						: item.done
							? 'border-success-500/30 bg-success-500/5'
							: 'border-surface-200-800 bg-surface-50-950'} {isLocked ? 'opacity-50' : ''}"
				>
					<!-- Step number + status -->
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2">
							{#if item.done}
								<div class="flex size-7 items-center justify-center rounded-full bg-success-500/20">
									<CheckCircleIcon class="size-4 text-success-500" />
								</div>
							{:else if isCurrent}
								<div class="flex size-7 items-center justify-center rounded-full bg-primary-500/20">
									<span class="text-xs font-bold text-primary-500">{item.step}</span>
								</div>
							{:else}
								<div
									class="flex size-7 items-center justify-center rounded-full bg-surface-200-800"
								>
									<span class="text-xs font-bold opacity-40">{item.step}</span>
								</div>
							{/if}
							<span class="text-[10px] font-semibold tracking-widest uppercase opacity-40">
								Step {item.step}
							</span>
						</div>
						<Icon
							class="size-5 {item.done
								? 'text-success-500'
								: isCurrent
									? 'text-primary-500'
									: 'opacity-30'}"
						/>
					</div>

					<!-- Content -->
					<div class="flex-1 space-y-1.5">
						<h3 class="text-sm font-bold">{item.title}</h3>
						<p class="text-xs leading-relaxed opacity-50">{item.description}</p>
					</div>

					<!-- Detail line -->
					<p
						class="text-[11px] font-medium {item.done
							? 'text-success-500'
							: isCurrent
								? 'text-primary-400'
								: 'opacity-40'}"
					>
						{item.detail}
					</p>

					<!-- Profile completeness mini-bar (only for step 1 when not done) -->
					{#if item.step === 1 && !item.done}
						<div class="h-1.5 overflow-hidden rounded-full bg-surface-200-800">
							<div
								class="h-full rounded-full bg-primary-500 transition-all duration-500"
								style="width: {completeness}%"
							></div>
						</div>
					{/if}

					<!-- CTA -->
					{#if !isLocked}
						<a
							href={item.href}
							class="btn gap-1.5 text-xs font-semibold {item.done
								? 'preset-tonal-success'
								: isCurrent
									? 'preset-filled-primary-500'
									: 'preset-tonal'}"
						>
							{item.cta}
							<ArrowRightIcon class="size-3.5" />
						</a>
					{:else}
						<div class="btn cursor-not-allowed preset-tonal text-xs font-semibold opacity-40">
							{item.cta}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</section>

	<!-- ─── What's next ──────────────────────────────────────────────── -->
	<section
		class="relative overflow-hidden rounded-2xl border border-surface-200-800 bg-surface-50-950 p-6 md:p-8"
	>
		<!-- Subtle decorative gradient -->
		<div
			class="pointer-events-none absolute inset-0 bg-linear-to-br from-primary-500/3 via-transparent to-tertiary-500/5"
		></div>

		<div class="relative space-y-5">
			<!-- Heading row -->
			<div class="flex items-center gap-2.5">
				<RocketIcon class="size-5 text-primary-500/70" />
				<h2 class="text-base font-bold">What's next</h2>
				<span class="text-xs opacity-40">
					{readyToGo
						? '— explore the tools below to start applying'
						: '— finish setup, then jump in'}
				</span>
			</div>

			<!-- Action tiles grid -->
			<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
				<!-- Roadmap -->
				<a
					href={resolve('/applications')}
					class="group flex flex-col items-center gap-2.5 rounded-xl border border-surface-200-800 bg-surface-100-900/50 p-4 text-center transition-all hover:border-primary-500/40 hover:bg-primary-500/5 hover:shadow-md"
				>
					<div
						class="flex size-10 items-center justify-center rounded-lg bg-primary-500/10 transition-colors group-hover:bg-primary-500/20"
					>
						<KanbanIcon class="size-5 text-primary-500/60 group-hover:text-primary-500" />
					</div>
					<span class="text-xs font-semibold opacity-60 group-hover:opacity-80">Roadmap</span>
					<span class="text-[10px] opacity-40">Track applications</span>
				</a>

				<!-- Audit Log -->
				<a
					href={resolve('/audit')}
					class="group flex flex-col items-center gap-2.5 rounded-xl border border-surface-200-800 bg-surface-100-900/50 p-4 text-center transition-all hover:border-warning-500/40 hover:bg-warning-500/5 hover:shadow-md"
				>
					<div
						class="flex size-10 items-center justify-center rounded-lg bg-warning-500/10 transition-colors group-hover:bg-warning-500/20"
					>
						<ScrollTextIcon class="size-5 text-warning-500/60 group-hover:text-warning-500" />
					</div>
					<span class="text-xs font-semibold opacity-60 group-hover:opacity-80">Audit Log</span>
					<span class="text-[10px] opacity-40">Review agent activity</span>
				</a>

				<!-- Resumes -->
				<a
					href={resolve('/resume')}
					class="group flex flex-col items-center gap-2.5 rounded-xl border border-surface-200-800 bg-surface-100-900/50 p-4 text-center transition-all hover:border-secondary-500/40 hover:bg-secondary-500/5 hover:shadow-md"
				>
					<div
						class="flex size-10 items-center justify-center rounded-lg bg-secondary-500/10 transition-colors group-hover:bg-secondary-500/20"
					>
						<TrendingUpIcon class="size-5 text-secondary-500/60 group-hover:text-secondary-500" />
					</div>
					<span class="text-xs font-semibold opacity-60 group-hover:opacity-80">Resumes</span>
					<span class="text-[10px] opacity-40">Craft tailored CVs</span>
				</a>

				<!-- Automations — featured card with sketched arrow -->
				<div class="relative">
					<!-- Hand-drawn sketched arrow pointing down to the card -->
					<svg
						class="pointer-events-none absolute -top-12 -right-2 z-10 h-16 w-20 -rotate-6 text-tertiary-500"
						viewBox="0 0 80 64"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
					>
						<!-- "try this!" label -->
						<text
							x="48"
							y="11"
							font-size="10"
							font-family="ui-monospace, monospace"
							font-weight="bold"
							font-style="italic"
							fill="currentColor"
							opacity="0.7"
							text-anchor="middle">try this!</text
						>
						<!-- Sketchy curved arrow body -->
						<path
							d="M 48 14 C 44 18, 38 22, 34 28 C 30 34, 28 40, 30 50"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-dasharray="5 3"
							opacity="0.65"
						/>
						<!-- Arrowhead drawn with two loose strokes -->
						<path
							d="M 24 44 L 30 52 L 36 45"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							opacity="0.65"
						/>
					</svg>

					<a
						href={resolve('/settings/automation')}
						class="group relative flex flex-col items-center gap-2.5 rounded-xl border-2 border-dashed border-tertiary-500/40 bg-tertiary-500/6 p-4 text-center transition-all hover:border-tertiary-500/70 hover:bg-tertiary-500/10 hover:shadow-lg hover:shadow-tertiary-500/10"
					>
						<div
							class="flex size-10 items-center justify-center rounded-lg bg-tertiary-500/15 transition-colors group-hover:bg-tertiary-500/25"
						>
							<BotIcon class="size-5 text-tertiary-500/80 group-hover:text-tertiary-500" />
						</div>
						<span class="text-xs font-bold text-tertiary-500/80 group-hover:text-tertiary-500"
							>Automations</span
						>
						<span class="text-[10px] opacity-40">Configure auto-apply</span>
					</a>
				</div>
			</div>
		</div>
	</section>

	<!-- ─── Footer tip ───────────────────────────────────────────────── -->
	<div
		class="flex items-start gap-3 rounded-lg border border-surface-200-800 bg-surface-50-950 p-4"
	>
		<SparklesIcon class="mt-0.5 size-4 shrink-0 text-primary-500/60" />
		<p class="text-[11px] leading-relaxed opacity-50">
			<strong class="opacity-80">Tip:</strong> HuntOS works best when your profile is thorough. The more
			detail you provide — skills, preferences, work authorization — the better your auto-generated resumes
			and application responses will be.
		</p>
	</div>
</div>
