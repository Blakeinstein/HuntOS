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
		MessageSquareIcon,
		FileTextIcon,
		TargetIcon
	} from '@lucide/svelte';
	import ProfileChat from '$lib/components/ProfileChat.svelte';
	import DocumentsPanel from '$lib/components/DocumentsPanel.svelte';
	import LinksManager from '$lib/components/LinksManager.svelte';

	let { data } = $props();

	const completeness = $derived(data.completeness ?? 0);
	const incompleteFields = $derived(data.incompleteFields ?? []);
	const profileData = $derived(data.profile ?? {});
	const documents = $derived(data.documents ?? []);
	const profileLinks = $derived(data.profileLinks ?? []);

	let formState = $state<Record<string, string | string[]>>({});
	let isSaving = $state(false);
	let saveSuccess = $state(false);
	let activeTab = $state('chat');

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
			label: 'Current Location',
			type: 'text',
			icon: MapPinIcon,
			placeholder: 'San Francisco, CA'
		}
	];

	const preferencesFields = [
		{
			key: 'job_titles',
			label: 'Target Job Titles',
			type: 'text',
			icon: TargetIcon,
			placeholder: 'Senior Frontend Engineer, Full-Stack Developer',
			hint: 'Comma-separated list of target roles'
		},
		{
			key: 'desired_location',
			label: 'Desired Work Location',
			type: 'text',
			icon: MapPinIcon,
			placeholder: 'Remote, New York, London'
		},
		{
			key: 'desired_job_type',
			label: 'Job Type',
			type: 'text',
			icon: BriefcaseIcon,
			placeholder: 'Full-time, Contract'
		},
		{
			key: 'desired_work_arrangement',
			label: 'Work Arrangement',
			type: 'text',
			icon: BriefcaseIcon,
			placeholder: 'Remote, Hybrid, On-site'
		},
		{
			key: 'salary_expectations',
			label: 'Salary Expectations',
			type: 'text',
			icon: BriefcaseIcon,
			placeholder: '$120k–$160k'
		},
		{
			key: 'job_search_criteria',
			label: 'Specific Criteria / Dealbreakers',
			type: 'textarea',
			icon: TargetIcon,
			placeholder:
				'Must have visa sponsorship, prefer companies > 100 employees, interested in fintech...'
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
			key: 'years_of_experience',
			label: 'Years of Experience',
			type: 'text',
			icon: BriefcaseIcon,
			placeholder: '8'
		},
		{
			key: 'experience',
			label: 'Experience Summary',
			type: 'textarea',
			icon: BriefcaseIcon,
			placeholder: 'Describe your work experience...'
		},
		{
			key: 'projects',
			label: 'Notable Projects',
			type: 'textarea',
			icon: WrenchIcon,
			placeholder: 'Open-source contributions, side projects, freelance work...'
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
		if (Object.keys(formState).length === 0) return;

		isSaving = true;
		saveSuccess = false;

		try {
			const res = await fetch('/api/profiles', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(formState)
			});

			if (!res.ok) {
				const err = await res.json().catch(() => ({ error: 'Unknown error' }));
				console.error('Failed to save profile:', err.error ?? err);
				return;
			}

			saveSuccess = true;
			formState = {};
			await invalidate('db:profile');
			setTimeout(() => (saveSuccess = false), 3000);
		} finally {
			isSaving = false;
		}
	}

	/**
	 * Renders a field group — shared between the personal, preferences, and professional tabs.
	 */
	type FieldDef = {
		key: string;
		label: string;
		type: string;
		icon: typeof UserIcon;
		placeholder: string;
		hint?: string;
	};
</script>

{#snippet fieldCard(field: FieldDef, layout: 'card' | 'inline')}
	{@const Icon = field.icon}
	{@const incomplete = isFieldIncomplete(field.key)}

	{#if layout === 'card'}
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
	{:else}
		<label class="label">
			<span class="flex items-center gap-1.5 text-sm font-medium">
				<Icon class="size-3.5 opacity-50" />
				{field.label}
				{#if incomplete}
					<span class="badge preset-filled-warning-500 text-[10px]">Required</span>
				{/if}
			</span>
			{#if field.hint}
				<p class="mt-0.5 text-xs opacity-50">{field.hint}</p>
			{/if}
			<div class="relative mt-1">
				{#if field.type === 'textarea'}
					<textarea
						class="textarea"
						class:border-warning-500={incomplete}
						rows="3"
						placeholder={field.placeholder}
						value={getFieldValue(field.key)}
						oninput={(e) => handleInput(field.key, e.currentTarget.value)}
					></textarea>
				{:else}
					<input
						type={field.type}
						class="input"
						class:border-warning-500={incomplete}
						placeholder={field.placeholder}
						value={getFieldValue(field.key)}
						oninput={(e) => handleInput(field.key, e.currentTarget.value)}
					/>
				{/if}
			</div>
		</label>
	{/if}
{/snippet}

<div class="mx-auto max-w-4xl space-y-6">
	<!-- Page header -->
	<div class="flex items-start justify-between gap-4">
		<div>
			<h1 class="h3 font-bold">Profile</h1>
			<p class="text-sm opacity-60">
				Build your profile with the AI assistant, upload documents, or edit details manually.
			</p>
		</div>
		{#if activeTab !== 'chat' && activeTab !== 'documents'}
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
		{/if}
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
	<Tabs value={activeTab} onValueChange={(details) => (activeTab = details.value ?? 'chat')}>
		<Tabs.List>
			<Tabs.Trigger value="chat">
				<MessageSquareIcon class="mr-1.5 size-4" />
				AI Builder
			</Tabs.Trigger>
			<Tabs.Trigger value="documents">
				<FileTextIcon class="mr-1.5 size-4" />
				Documents
				{#if documents.length > 0}
					<span
						class="ml-1 rounded-full bg-primary-500/20 px-1.5 py-0.5 text-[10px] font-bold text-primary-500"
					>
						{documents.length}
					</span>
				{/if}
			</Tabs.Trigger>
			<Tabs.Trigger value="personal">
				<UserIcon class="mr-1.5 size-4" />
				Personal
			</Tabs.Trigger>
			<Tabs.Trigger value="preferences">
				<TargetIcon class="mr-1.5 size-4" />
				Preferences
			</Tabs.Trigger>
			<Tabs.Trigger value="professional">
				<BriefcaseIcon class="mr-1.5 size-4" />
				Professional
			</Tabs.Trigger>
			<Tabs.Trigger value="links">
				<LinkIcon class="mr-1.5 size-4" />
				Links
			</Tabs.Trigger>
			<Tabs.Indicator />
		</Tabs.List>

		<!-- AI Builder tab (default) -->
		<Tabs.Content value="chat">
			<div class="mt-4">
				<ProfileChat />
			</div>
		</Tabs.Content>

		<!-- Documents tab -->
		<Tabs.Content value="documents">
			<div class="mt-4">
				<DocumentsPanel {documents} />
			</div>
		</Tabs.Content>

		<!-- Personal Info tab -->
		<Tabs.Content value="personal">
			<div class="mt-4 card border border-surface-200-800 bg-surface-50-950 p-5">
				<h2 class="mb-4 flex items-center gap-2 text-sm font-bold">
					<UserIcon class="size-4 text-primary-500" />
					Personal Information
				</h2>
				<div class="grid gap-4 md:grid-cols-2">
					{#each personalFields as field (field.key)}
						{@render fieldCard(field, 'inline')}
					{/each}
				</div>
			</div>
		</Tabs.Content>

		<!-- Job Preferences tab -->
		<Tabs.Content value="preferences">
			<div class="mt-4 space-y-4">
				{#each preferencesFields as field (field.key)}
					{@render fieldCard(field, field.type === 'textarea' ? 'card' : 'card')}
				{/each}
			</div>
		</Tabs.Content>

		<!-- Professional tab -->
		<Tabs.Content value="professional">
			<div class="mt-4 space-y-4">
				{#each professionalFields as field (field.key)}
					{@render fieldCard(field, 'card')}
				{/each}
			</div>
		</Tabs.Content>

		<!-- Links tab -->
		<Tabs.Content value="links">
			<div class="mt-4 card border border-surface-200-800 bg-surface-50-950 p-5">
				<LinksManager links={profileLinks} />
			</div>
		</Tabs.Content>
	</Tabs>
</div>
