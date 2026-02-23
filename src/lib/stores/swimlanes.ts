import { derived, writable } from 'svelte/store';
import type { Swimlane } from '$lib/services/types';

export const swimlanes = writable<Swimlane[]>([]);
export const selectedSwimlane = writable<Swimlane | null>(null);

export const swimlanesById = derived(swimlanes, ($swimlanes) => {
	const map = new Map<number, Swimlane>();
	for (const lane of $swimlanes) {
		map.set(lane.id, lane);
	}
	return map;
});

export const swimlaneNames = derived(swimlanes, ($swimlanes) =>
	$swimlanes.map((lane) => lane.name)
);

export function setSwimlanes(next: Swimlane[]) {
	swimlanes.set(next);
}

export function clearSwimlanes() {
	swimlanes.set([]);
	selectedSwimlane.set(null);
}
