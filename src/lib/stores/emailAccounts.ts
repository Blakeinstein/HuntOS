import { writable } from 'svelte/store';
import type { EmailAccount } from '$lib/services/types';

export const emailAccounts = writable<EmailAccount[]>([]);
export const emailAccountsLoading = writable(false);

export function setEmailAccounts(accounts: EmailAccount[]) {
	emailAccounts.set(accounts);
}

export function setEmailAccountsLoading(isLoading: boolean) {
	emailAccountsLoading.set(isLoading);
}

export function clearEmailAccounts() {
	emailAccounts.set([]);
}
