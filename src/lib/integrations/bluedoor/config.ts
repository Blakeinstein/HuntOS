import { env } from '$env/dynamic/private';

export const BLUEDOOR_DEFAULT_API_BASE = 'https://api.bluedoor.sh/job-postings/v1';

export function getBluedoorApiKey(): string | undefined {
	const key = env.BLUEDOOR_API_KEY?.trim();
	return key || undefined;
}

export function getBluedoorUserAgent(): string {
	return env.BLUEDOOR_USER_AGENT?.trim() || 'HuntOS/0.0.1 (+https://github.com/Blakeinstein/HuntOS)';
}
