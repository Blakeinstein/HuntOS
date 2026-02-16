import { derived, writable } from 'svelte/store';
import type { JobBoardConfig } from '$lib/services/services/jobBoard';

export const jobBoards = writable<JobBoardConfig[]>([]);
export const jobBoardsLoading = writable(false);

export const jobBoardCount = derived(jobBoards, ($jobBoards) => $jobBoards.length);

export const enabledJobBoards = derived(jobBoards, ($jobBoards) =>
	$jobBoards.filter((board) => board.is_enabled)
);

export function setJobBoards(boards: JobBoardConfig[]) {
	jobBoards.set(boards);
}

export function setJobBoardsLoading(loading: boolean) {
	jobBoardsLoading.set(loading);
}
