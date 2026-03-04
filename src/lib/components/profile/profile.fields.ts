// src/lib/components/profile/profile.fields.ts
// Shared field definitions and types used across all profile tab components.
// Centralised here so each tab component imports from one source of truth
// rather than duplicating field arrays inside the page file.

import {
	UserIcon,
	MailIcon,
	PhoneIcon,
	MapPinIcon,
	WrenchIcon,
	BriefcaseIcon,
	GraduationCapIcon,
	TargetIcon,
	IdCardIcon,
	ShieldCheckIcon,
	NotebookPenIcon,
	PlaneIcon
} from '@lucide/svelte';

// ── Shared type ───────────────────────────────────────────────────────────────

export type FieldDef = {
	key: string;
	label: string;
	/** Input type. Use 'textarea' for multi-line, 'select' for a dropdown. */
	type: 'text' | 'email' | 'tel' | 'date' | 'textarea' | 'select';
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	icon: any;
	placeholder?: string;
	hint?: string;
	options?: { value: string; label: string }[];
	/**
	 * Optional predicate — when provided, the field is only shown if this
	 * function returns true given the current form/profile state.
	 */
	showIf?: (data: Record<string, string | string[]>) => boolean;
};

// ── Personal ─────────────────────────────────────────────────────────────────

export const personalFields: FieldDef[] = [
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

// ── Preferences ───────────────────────────────────────────────────────────────

export const preferencesFields: FieldDef[] = [
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

// ── Work Authorization & Immigration ─────────────────────────────────────────

/**
 * Predicate used by visa-validity fields — they are only shown when the user
 * has indicated they hold an active visa/permit (i.e. NOT a citizen/PR and NOT
 * "no"), or when they have already entered a visa type.
 */
function hasActiveVisa(data: Record<string, string | string[]>): boolean {
	const active = data['has_active_visa'];
	const visaType = data['visa_type'];
	const hasVisa =
		typeof active === 'string' && active !== '' && active !== 'no' && active !== 'citizen';
	const hasType = typeof visaType === 'string' && visaType.trim().length > 0;
	return hasVisa || hasType;
}

export const workAuthFields: FieldDef[] = [
	{
		key: 'has_active_visa',
		label: 'Do you currently hold an active visa?',
		type: 'select',
		icon: IdCardIcon,
		hint: 'Indicate whether you are currently authorised to work in your target country.',
		options: [
			{ value: '', label: '— Select —' },
			{ value: 'yes', label: 'Yes' },
			{ value: 'no', label: 'No' },
			{ value: 'citizen', label: 'N/A — Citizen / Permanent Resident' }
		]
	},
	{
		key: 'visa_type',
		label: 'Visa / Work Permit Type',
		type: 'text',
		icon: IdCardIcon,
		placeholder: 'e.g. H-1B, Tier 2, Working Holiday, PR, Citizen',
		hint: 'If you have a visa or work permit, specify the type here.'
	},
	{
		key: 'needs_sponsorship',
		label: 'Do you need employer work-authorization sponsorship?',
		type: 'select',
		icon: ShieldCheckIcon,
		hint: 'Employers often filter candidates based on sponsorship requirements.',
		options: [
			{ value: '', label: '— Select —' },
			{ value: 'yes', label: 'Yes — I require sponsorship' },
			{ value: 'no', label: 'No — I do not need sponsorship' },
			{ value: 'future', label: 'Not now, but may need in the future' }
		]
	},
	{
		key: 'open_to_relocate',
		label: 'Are you open to relocating?',
		type: 'select',
		icon: PlaneIcon,
		options: [
			{ value: '', label: '— Select —' },
			{ value: 'yes', label: 'Yes — open to relocation' },
			{ value: 'no', label: 'No — prefer to stay in current location' },
			{ value: 'conditional', label: 'Conditional — depends on role / package' }
		]
	},
	{
		key: 'current_work_preference',
		label: 'Current Working Preference',
		type: 'select',
		icon: BriefcaseIcon,
		hint: 'Where do you prefer to work right now?',
		options: [
			{ value: '', label: '— Select —' },
			{ value: 'remote', label: 'Remote only' },
			{ value: 'hybrid', label: 'Hybrid (some days on-site)' },
			{ value: 'onsite', label: 'On-site / In-office' },
			{ value: 'flexible', label: 'Flexible — no strong preference' }
		]
	},
	{
		key: 'visa_expiry_date',
		label: 'Visa / Permit Expiry Date',
		type: 'date',
		icon: IdCardIcon,
		hint: 'The date your current visa or work permit expires. Used by the agent to answer expiry-related questions on application forms.',
		showIf: hasActiveVisa
	},
	{
		key: 'work_auth_valid_until',
		label: 'Work Authorization Valid Until',
		type: 'date',
		icon: ShieldCheckIcon,
		hint: 'If your work authorization (e.g. OPT, EAD, bridging visa) has a separate validity end date, enter it here.',
		showIf: hasActiveVisa
	},
	{
		key: 'immigration_notes',
		label: 'Additional Immigration / Work-Auth Notes',
		type: 'textarea',
		icon: NotebookPenIcon,
		placeholder:
			'Any context recruiters or the application system should know — visa expiry, OPT/CPT details, etc.',
		hint: 'Optional free-text notes. These will be used by the agent when filling application forms.'
	}
];

// ── Professional ──────────────────────────────────────────────────────────────

export const professionalFields: FieldDef[] = [
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

// ── Application Notes ─────────────────────────────────────────────────────────

export const applicationNotesField: FieldDef = {
	key: 'application_notes',
	label: 'Additional Notes for Applications',
	type: 'textarea',
	icon: NotebookPenIcon,
	placeholder:
		'Anything else you want the application agent to know or mention — career goals, personal brand, specific achievements to highlight, talking points, etc.',
	hint: 'These notes are passed to every application the agent submits on your behalf.'
};
