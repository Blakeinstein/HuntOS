<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { Tabs } from '@skeletonlabs/skeleton-svelte';
	import {
		UserIcon,
		MailIcon,
		PhoneIcon,
		MapPinIcon,
		WrenchIcon,
		BriefcaseIcon,
		GraduationCapIcon,
		LinkIcon,
		SaveIcon,
		CheckCircleIcon,
		AlertCircleIcon,
		MessageSquareIcon
	} from '@lucide/svelte';

	let { data } = $props();

	const completeness = $derived(data.completeness ?? 0);
	const incompleteFields = $derived(data.incompleteFields ?? []);
	const profileData = $derived(data.profile ?? {});

	let formState = $state<Record<string, string | string[]>>({});
	let isSaving = $state(false);
	let saveSuccess = $state(false);
	let activeTab = $state('personal');

	const mergedProfile = $derived.by(() => ({ ...profileData, ...formState }));

	const personalFields = [
		{ key: 'name', label: 'Full Name', type: 'text', icon: UserIcon, placeholder: 'John Doe' },
		{
			key: 'email',
			label: 'Email Address',
			type: 'email',
			icon: MailIcon,
			placeholder: 'john@example.com'
		},
		{
			key: 'phone',
			label: 'Phone Number',
			type: 'tel',
			icon: PhoneIcon,
			placeholder: '+1 (555) 123-4567'
		},
		{
			key: 'location',
			label: 'Location',
			type: 'text',
			icon: MapPinIcon,
			placeholder: 'San Francisco, CA'
		}
	];

	const professionalFields = [
		{
			key: 'skills',
			label: 'Skills',
			type: 'text',
			icon: WrenchIcon,
			placeholder: 'TypeScript, React, Node.js, Python',
			hint: 'Comma-separated list of skills'
		},
		{
			key: 'experience',
			label: 'Experience Summary',
			type: 'textarea',
			icon: BriefcaseIcon,
			placeholder: 'Describe your work experience...'
		},
		{
			key: 'education',
			label: 'Education',
			type: 'textarea',
			icon: GraduationCapIcon,
			placeholder: 'BS in Computer Science, MIT, 2020'
		},
		{
			key: 'resume_summary',
			label: 'Resume Summary',
			type: 'textarea',
			icon: BriefcaseIcon,
			placeholder: 'A brief professional summary for your resume...'
		}
	];

	const linkFields = [
		{
			key: 'linkedin_url',
			label: 'LinkedIn URL',
			type: 'url',
			icon: LinkIcon,
			placeholder: 'https://linkedin.com/in/yourname'
		},
		{
			key: 'portfolio_url',
			label: 'Portfolio URL',
			type: 'url',
			icon: LinkIcon,
			placeholder: 'https://yourportfolio.com'
		}
	];

	function handleInput(key: string, value: string) {
		formState = { ...formState, [key]: value };
	}

	function getFieldValue(key: string): string {
		const val = formState[key] ?? profileData[key] ?? '';
		return Array.isArray(val) ? val.join(', ') : val;
	}

	function isFieldIncomplete(key: string): boolean {
		return incompleteFields.includes(key as import('$lib/services').ProfileKey);
	}

	function getCompletenessColor(): string {
		if (completeness >= 80) return 'bg-success-500';
		if (completeness >= 50) return 'bg-warning-500';
		return 'bg-error-500';
	}

	async function saveProfile() {
		isSaving = true;
		saveSuccess = false;

		try {
			await fetch('/api/profiles', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(mergedProfile)
			});
			saveSuccess = true;
			formState = {};
			await invalidate('db:profile');
			setTimeout(() => (saveSuccess = false), 3000);
		} finally {
			isSaving = false;
		}
	}
</script>

<div class="mx-auto max-w-4xl space-y-6">
	<!-- Page header -->
	<div class="flex items-start justify-between gap-4">
		<div>
			<h1 class="h3 font-bold">Profile</h1>
			<p class="text-sm opacity-60">
				Keep your profile updated so the automation agent can fill out applications accurately.
			</p>
		</div>
		<button
			type="button"
			class="btn gap-2 preset-filled-primary-500"
			disabled={isSaving}
			onclick={saveProfile}
		>
			{#if isSaving}
				<span class="animate-spin">⏳</span>
				<span>Saving...</span>
			{:else if saveSuccess}
				<CheckCircleIcon class="size-4" />
				<span>Saved!</span>
			{:else}
				<SaveIcon class="size-4" />
				<span>Save Profile</span>
			{/if}
		</button>
	</div>

	<!-- Completeness card -->
	<div class="card border border-surface-200-800 bg-surface-50-950 p-5">
		<div class="flex items-center justify-between">
			<div>
				<h2 class="text-sm font-bold">Profile Completeness</h2>
				{#if incompleteFields.length > 0}
					<p class="mt-0.5 flex items-center gap-1.5 text-xs opacity-60">
						<AlertCircleIcon class="size-3 text-warning-500" />
						Missing: {incompleteFields.join(', ')}
					</p>
				{:else}
					<p class="mt-0.5 flex items-center gap-1.5 text-xs text-success-500">
						<CheckCircleIcon class="size-3" />
						All required fields are filled
					</p>
				{/if}
			</div>
			<div class="text-right">
				<span class="text-2xl font-bold">{completeness}%</span>
			</div>
		</div>
		<div class="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-200-800">
			<div
				class="h-full rounded-full transition-all duration-500 {getCompletenessColor()}"
				style="width: {completeness}%"
			></div>
		</div>
	</div>

	<!-- Tabbed sections -->
	<Tabs value={activeTab} onValueChange={(details) => (activeTab = details.value ?? 'personal')}>
		<Tabs.List>
			<Tabs.Trigger value="personal">
				<UserIcon class="mr-1.5 size-4" />
				Personal
			</Tabs.Trigger>
			<Tabs.Trigger value="professional">
				<BriefcaseIcon class="mr-1.5 size-4" />
				Professional
			</Tabs.Trigger>
			<Tabs.Trigger value="links">
				<LinkIcon class="mr-1.5 size-4" />
				Links
			</Tabs.Trigger>
			<Tabs.Trigger value="chat">
				<MessageSquareIcon class="mr-1.5 size-4" />
				AI Builder
			</Tabs.Trigger>
			<Tabs.Indicator />
		</Tabs.List>

		<!-- Personal Info tab -->
		<Tabs.Content value="personal">
			<div class="mt-4 card border border-surface-200-800 bg-surface-50-950 p-5">
				<h2 class="mb-4 flex items-center gap-2 text-sm font-bold">
					<UserIcon class="size-4 text-primary-500" />
					Personal Information
				</h2>
				<div class="grid gap-4 md:grid-cols-2">
					{#each personalFields as field (field.key)}
						{@const Icon = field.icon}
						{@const incomplete = isFieldIncomplete(field.key)}
						<label class="label">
							<span class="flex items-center gap-1.5 text-sm font-medium">
								<Icon class="size-3.5 opacity-50" />
								{field.label}
								{#if incomplete}
									<span class="badge preset-filled-warning-500 text-[10px]">Required</span>
								{/if}
							</span>
							<div class="relative mt-1">
								<input
									type={field.type}
									class="input"
									class:border-warning-500={incomplete}
									placeholder={field.placeholder}
									value={getFieldValue(field.key)}
									oninput={(e) => handleInput(field.key, e.currentTarget.value)}
								/>
							</div>
						</label>
					{/each}
				</div>
			</div>
		</Tabs.Content>

		<!-- Professional tab -->
		<Tabs.Content value="professional">
			<div class="mt-4 space-y-4">
				{#each professionalFields as field (field.key)}
					{@const Icon = field.icon}
					{@const incomplete = isFieldIncomplete(field.key)}
					<div class="card border border-surface-200-800 bg-surface-50-950 p-5">
						<label class="label">
							<span class="flex items-center gap-1.5 text-sm font-bold">
								<Icon class="size-4 text-primary-500" />
								{field.label}
								{#if incomplete}
									<span class="badge preset-filled-warning-500 text-[10px]">Required</span>
								{/if}
							</span>
							{#if field.hint}
								<p class="mt-0.5 text-xs opacity-50">{field.hint}</p>
							{/if}
							{#if field.type === 'textarea'}
								<textarea
									class="mt-2 textarea"
									class:border-warning-500={incomplete}
									rows="4"
									placeholder={field.placeholder}
									value={getFieldValue(field.key)}
									oninput={(e) => handleInput(field.key, e.currentTarget.value)}
								></textarea>
							{:else}
								<input
									type={field.type}
									class="mt-2 input"
									class:border-warning-500={incomplete}
									placeholder={field.placeholder}
									value={getFieldValue(field.key)}
									oninput={(e) => handleInput(field.key, e.currentTarget.value)}
								/>
							{/if}
						</label>
					</div>
				{/each}
			</div>
		</Tabs.Content>

		<!-- Links tab -->
		<Tabs.Content value="links">
			<div class="mt-4 card border border-surface-200-800 bg-surface-50-950 p-5">
				<h2 class="mb-4 flex items-center gap-2 text-sm font-bold">
					<LinkIcon class="size-4 text-primary-500" />
					Online Profiles & Links
				</h2>
				<div class="grid gap-4 md:grid-cols-1">
					{#each linkFields as field (field.key)}
						{@const Icon = field.icon}
						<label class="label">
							<span class="flex items-center gap-1.5 text-sm font-medium">
								<Icon class="size-3.5 opacity-50" />
								{field.label}
							</span>
							<input
								type={field.type}
								class="mt-1 input"
								placeholder={field.placeholder}
								value={getFieldValue(field.key)}
								oninput={(e) => handleInput(field.key, e.currentTarget.value)}
							/>
						</label>
					{/each}
				</div>
			</div>
		</Tabs.Content>

		<!-- AI Builder tab (placeholder) -->
		<Tabs.Content value="chat">
			<div class="mt-4 card border border-surface-200-800 bg-surface-50-950 p-8">
				<div class="flex flex-col items-center justify-center text-center">
					<div class="flex size-16 items-center justify-center rounded-full bg-primary-500/10">
						<MessageSquareIcon class="size-8 text-primary-500" />
					</div>
					<h2 class="mt-4 h5 font-bold">AI Profile Builder</h2>
					<p class="mt-2 max-w-md text-sm opacity-60">
						Converse with an AI assistant to build your professional profile. The assistant will ask
						targeted questions about your experience, skills, and preferences to fill out your
						profile automatically.
					</p>
					<p class="mt-4 text-xs opacity-40">
						This feature requires Copilot Kit integration and is not yet implemented.
					</p>
					<button type="button" class="mt-4 btn preset-tonal" disabled> Coming Soon </button>
				</div>
			</div>
		</Tabs.Content>
	</Tabs>
</div>
