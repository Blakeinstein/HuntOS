import { Database } from '$lib/services/services/database';
import '$lib/services/helpers/ensureDataDirs';

export const db = new Database();

export type { Database };
