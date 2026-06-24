const BLUEDOOR_HOST = 'api.bluedoor.sh';

/**
 * Returns true when the job board URL should be fetched via the bluedoor HTTP API
 * instead of a browser scraping agent.
 */
export function isBluedoorUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		if (parsed.hostname !== BLUEDOOR_HOST) return false;
		return /\/job-postings\/v\d+\/jobs\/search\/?$/i.test(parsed.pathname);
	} catch {
		return false;
	}
}
