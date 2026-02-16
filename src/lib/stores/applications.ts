import { derived, writable } from 'svelte/store';
import type { ApplicationWithSwimlane } from '$lib/services/services/application';

export const applications = writable<ApplicationWithSwimlane[]>([]);
export const selectedApplication = writable<ApplicationWithSwimlane | null>(null);
export const applicationsLoading = writable(false);

export const applicationsBySwimlane = derived(applications, ($applications) => {
	const map = new Map<number, ApplicationWithSwimlane[]>();

	for (const application of $applications) {
		if (!map.has(application.status_swimlane_id)) {
			map.set(application.status_swimlane_id, []);
		}
		map.get(application.status_swimlane_id)!.push(application);
	}

	return map;
});

export const applicationStats = derived(applications, ($applications) => {
	const stats = new Map<string, number>();

	for (const application of $applications) {
		const current = stats.get(application.swimlane_name) ?? 0;
		stats.set(application.swimlane_name, current + 1);
	}

	return stats;
});

export async function fetchApplications() {
	applicationsLoading.set(true);

	try {
		const response = await fetch('/api/applications');
		if (!response.ok) {
			throw new Error('Failed to fetch applications');
		}

		const data = (await response.json()) as ApplicationWithSwimlane[];
		applications.set(data);
	} finally {
		applicationsLoading.set(false);
	}
}

export function selectApplication(application: ApplicationWithSwimlane | null) {
	selectedApplication.set(application);
}
