import { writable } from 'svelte/store';
import type { ProfileData, ProfileKey } from '$lib/services/types';

export const profile = writable<ProfileData>({});
export const profileIncompleteFields = writable<ProfileKey[]>([]);
export const profileCompleteness = writable(0);

export function resetProfileStores() {
	profile.set({});
	profileIncompleteFields.set([]);
	profileCompleteness.set(0);
}
