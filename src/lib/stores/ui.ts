import { writable, derived } from 'svelte/store';

export type NavSection = 'applications' | 'profiles' | 'settings';

export interface ToastMessage {
	id: string;
	title: string;
	message?: string;
	tone?: 'info' | 'success' | 'warning' | 'error';
	timeoutMs?: number;
}

export const activeNav = writable<NavSection>('applications');

export const isSidebarOpen = writable(false);
export const isCommandPaletteOpen = writable(false);
export const isSaving = writable(false);

export const toasts = writable<ToastMessage[]>([]);

export const hasToasts = derived(toasts, ($toasts) => $toasts.length > 0);

export function pushToast(toast: Omit<ToastMessage, 'id'>) {
	const id = crypto.randomUUID();
	toasts.update((items) => [...items, { id, ...toast }]);
	return id;
}

export function removeToast(id: string) {
	toasts.update((items) => items.filter((toast) => toast.id !== id));
}

export function clearToasts() {
	toasts.set([]);
}
