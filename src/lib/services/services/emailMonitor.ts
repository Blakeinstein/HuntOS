import type { Database } from './database';
// NOTE: You'll need to install an IMAP client library, e.g., `npm install mail-parser imap-simple`
// For the purpose of this file, we'll assume a client with a similar API exists.
// Let's define a placeholder for the client and message types.

interface ImapMessage {
	attributes: { uid: number; flags: string[] };
	parts: { which: string; body: string }[];
}

interface SimpleImapClient {
	connect(): Promise<void>;
	end(): Promise<void>;
	openBox(boxName: string): Promise<void>;
	search(criteria: any[], fetchOptions: any): Promise<ImapMessage[]>;
}

export interface EmailAccount {
	id: number;
	user_id: number;
	provider: string;
	host: string;
	port: number;
	username: string;
	password_encrypted: string;
	is_default: boolean;
	created_at: string;
}

export interface EmailMessage {
	id: number;
	application_id?: number;
	email_account_id: number;
	message_id: string;
	subject: string;
	sender: string;
	sender_email: string;
	received_at: string;
	processed: boolean;
	processed_at?: string;
	status_update?: string;
	body?: string;
	raw_body?: string;
}

export interface EmailStatusUpdate {
	status: string;
	applicationId?: number;
	reason?: string;
	confidence: number;
}

export type EmailProvider = 'gmail' | 'outlook' | 'imap';

export class EmailMonitorService {
	private db: Database;
	private clients: Map<number, SimpleImapClient> = new Map();

	constructor(db: Database) {
		this.db = db;
	}

	/**
	 * Get all email accounts
	 */
	async getEmailAccounts(): Promise<EmailAccount[]> {
		return this.db.all(`SELECT * FROM email_accounts ORDER BY is_default DESC, created_at ASC`);
	}

	/**
	 * Get a single email account by ID
	 */
	async getEmailAccount(id: number): Promise<EmailAccount | null> {
		return this.db.get(`SELECT * FROM email_accounts WHERE id = ?`, [id]);
	}

	/**
	 * Create a new email account
	 */
	async createEmailAccount(data: {
		provider: EmailProvider;
		host: string;
		port: number;
		username: string;
		password: string;
		isDefault?: boolean;
	}): Promise<number> {
		const { provider, host, port, username, password, isDefault = false } = data;

		const encryptedPassword = this.encryptPassword(password);

		const result = await this.db.run(
			`
      INSERT INTO email_accounts (user_id, provider, host, port, username, password_encrypted, is_default, created_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, datetime('now'))
      `,
			[provider, host, port, username, encryptedPassword, isDefault ? 1 : 0]
		);

		if (isDefault) {
			await this.db.run(`UPDATE email_accounts SET is_default = 0 WHERE id != ?`, [
				result.lastInsertRowid
			]);
		}

		return Number(result.lastInsertRowid);
	}

	/**
	 * Update email account
	 */
	async updateEmailAccount(id: number, data: Partial<EmailAccount & { password?: string }>) {
		const updates: string[] = [];
		const values: any[] = [];

		if (data.host !== undefined) {
			updates.push('host = ?');
			values.push(data.host);
		}
		if (data.port !== undefined) {
			updates.push('port = ?');
			values.push(data.port);
		}
		if (data.username !== undefined) {
			updates.push('username = ?');
			values.push(data.username);
		}
		if (data.password !== undefined) {
			updates.push('password_encrypted = ?');
			values.push(this.encryptPassword(data.password));
		}
		if (data.is_default !== undefined) {
			updates.push('is_default = ?');
			values.push(data.is_default ? 1 : 0);
		}

		if (updates.length === 0) return;

		values.push(id);
		await this.db.run(`UPDATE email_accounts SET ${updates.join(', ')} WHERE id = ?`, values);
	}

	/**
	 * Delete email account
	 */
	async deleteEmailAccount(id: number): Promise<void> {
		await this.db.run(`DELETE FROM email_accounts WHERE id = ?`, [id]);
	}

	/**
	 * Connect to email account
	 */
	async connectEmailAccount(accountId: number): Promise<SimpleImapClient> {
		const account = await this.getEmailAccount(accountId);
		if (!account) {
			throw new Error(`Email account ${accountId} not found`);
		}

		// This is a placeholder for a real IMAP client instantiation
		const client: SimpleImapClient = {
			connect: async () => console.log('Connecting to IMAP...'),
			end: async () => console.log('Disconnecting from IMAP...'),
			openBox: async (box: string) => console.log(`Opening box ${box}...`),
			search: async () => {
				console.log('Searching emails...');
				return [];
			}
		};

		await client.connect();
		this.clients.set(accountId, client);
		return client;
	}

	/**
	 * Disconnect from email account
	 */
	async disconnectEmailAccount(accountId: number): Promise<void> {
		const client = this.clients.get(accountId);
		if (client) {
			await client.end();
			this.clients.delete(accountId);
		}
	}

	/**
	 * Sync emails from account
	 */
	async syncEmails(accountId?: number): Promise<EmailMessage[]> {
		const accounts = accountId
			? [await this.getEmailAccount(accountId)]
			: await this.getEmailAccounts();
		const messages: EmailMessage[] = [];

		for (const account of accounts.filter((a): a is EmailAccount => a !== null)) {
			let client = this.clients.get(account.id);
			if (!client || !this.clients.has(account.id)) {
				client = await this.connectEmailAccount(account.id);
			}
			const newMessages = await this.fetchUnreadMessages(account.id, client);
			messages.push(...newMessages);
		}
		return messages;
	}

	private async fetchUnreadMessages(
		accountId: number,
		client: SimpleImapClient
	): Promise<EmailMessage[]> {
		// Placeholder implementation
		console.log(`Fetching unread messages for account ${accountId}`);
		return [];
	}

	/**
	 * Parse email for application status
	 */
	parseEmailStatus(email: EmailMessage): EmailStatusUpdate | null {
		const subject = email.subject.toLowerCase();
		const body = (email.raw_body || '').toLowerCase();

		if (this.containsAny(subject, ['interview', 'schedule', 'call', 'conversation'])) {
			return { status: 'Interview', confidence: 0.9 };
		}
		if (this.containsAny(subject, ['offer', 'congratulations', 'welcome'])) {
			return { status: 'Offer', confidence: 0.85 };
		}
		if (this.containsAny(subject, ['unfortunately', 'not moving forward', 'rejected'])) {
			return { status: 'Rejected', confidence: 0.9 };
		}
		if (this.containsAny(subject, ['action required', 'information', 'follow-up'])) {
			return { status: 'Action Required', confidence: 0.7 };
		}

		return null;
	}

	/**
	 * Process email and update application status
	 */
	async processEmail(emailId: number): Promise<void> {
		const email = await this.db.get<EmailMessage>(`SELECT * FROM email_messages WHERE id = ?`, [
			emailId
		]);
		if (!email || email.processed) return;

		const statusUpdate = this.parseEmailStatus(email);
		if (!statusUpdate) return;

		const applicationId = email.application_id || (await this.findApplicationByEmail(email));
		if (!applicationId) return;

		let swimlane = await this.db.get<{ id: number }>(
			`SELECT id FROM swimlanes WHERE name = ? LIMIT 1`,
			[statusUpdate.status]
		);

		if (!swimlane) {
			const maxOrder = await this.db.get<{ max: number }>(
				`SELECT MAX(order_index) as max FROM swimlanes`
			);
			const result = await this.db.run(
				`INSERT INTO swimlanes (name, description, is_custom, order_index, created_at) VALUES (?, ?, 1, ?, datetime('now'))`,
				[statusUpdate.status, `${statusUpdate.status} applications`, (maxOrder?.max || 0) + 1]
			);
			swimlane = { id: Number(result.lastInsertRowid) };
		}

		await this.db.run(
			`UPDATE applications SET status_swimlane_id = ?, updated_at = datetime('now') WHERE id = ?`,
			[swimlane.id, applicationId]
		);
		await this.db.run(
			`INSERT INTO application_history (application_id, swimlane_id, changed_by, reason, created_at) VALUES (?, ?, 'email_monitor', ?, datetime('now'))`,
			[applicationId, swimlane.id, `Email subject: ${email.subject}`]
		);
		await this.db.run(
			`UPDATE email_messages SET processed = 1, processed_at = datetime('now'), status_update = ? WHERE id = ?`,
			[statusUpdate.status, emailId]
		);
	}

	private async findApplicationByEmail(email: EmailMessage): Promise<number | null> {
		const companies = await this.db.all<{ company: string }>(
			`SELECT DISTINCT company FROM applications`
		);
		const sender = email.sender.toLowerCase();
		const subject = email.subject.toLowerCase();

		for (const { company } of companies) {
			const companyName = company.toLowerCase();
			if (sender.includes(companyName) || subject.includes(companyName)) {
				const app = await this.db.get<{ id: number }>(
					`SELECT id FROM applications WHERE company = ? ORDER BY created_at DESC LIMIT 1`,
					[company]
				);
				if (app) return app.id;
			}
		}
		return null;
	}

	private containsAny(text: string, terms: string[]): boolean {
		return terms.some((term) => text.includes(term));
	}

	private encryptPassword(password: string): string {
		// In a real application, use a robust encryption library like crypto.
		return Buffer.from(password).toString('base64');
	}

	private decryptPassword(encrypted: string): string {
		// In a real application, use a robust encryption library like crypto.
		return Buffer.from(encrypted, 'base64').toString('utf8');
	}
}
