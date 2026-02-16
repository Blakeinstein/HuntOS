import path from 'path';
import sqlite3 from 'better-sqlite3';
import fs from 'fs';

export class Database {
	private db: sqlite3.Database;

	constructor(dbPath?: string) {
		const finalDbPath = dbPath || path.join(process.cwd(), 'data', 'app.db');
		const dir = path.dirname(finalDbPath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}

		this.db = new sqlite3(finalDbPath, { verbose: console.log });
		this.init();
	}

	/**
	 * Initialize database schema
	 */
	private init(): void {
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        company TEXT NOT NULL,
        job_description_url TEXT,
        job_description TEXT,
        status_swimlane_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_activity DATETIME,
        FOREIGN KEY (status_swimlane_id) REFERENCES swimlanes(id)
      );

      CREATE TABLE IF NOT EXISTS swimlanes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        is_custom BOOLEAN DEFAULT 1,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(user_id, key)
      );

      CREATE TABLE IF NOT EXISTS application_fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER NOT NULL,
        field_name TEXT NOT NULL,
        field_value TEXT,
        is_required BOOLEAN DEFAULT 0,
        status TEXT DEFAULT 'pending', -- pending, filled, missing, user_input_required
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
        UNIQUE(application_id, field_name)
      );

      CREATE TABLE IF NOT EXISTS resumes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        job_description_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS email_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        provider TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        username TEXT NOT NULL,
        password_encrypted TEXT NOT NULL,
        is_default BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS job_boards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        check_interval_minutes INTEGER NOT NULL DEFAULT 1440,
        last_checked DATETIME,
        next_check DATETIME,
        is_enabled BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS job_board_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_board_id INTEGER NOT NULL,
        username TEXT,
        password_encrypted TEXT,
        session_cookie TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (job_board_id) REFERENCES job_boards(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS email_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER,
        email_account_id INTEGER NOT NULL,
        message_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        sender TEXT NOT NULL,
        sender_email TEXT,
        received_at DATETIME NOT NULL,
        processed BOOLEAN DEFAULT 0,
        processed_at DATETIME,
        status_update TEXT,
        body TEXT,
        raw_body TEXT,
        FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL,
        FOREIGN KEY (email_account_id) REFERENCES email_accounts(id) ON DELETE CASCADE,
        UNIQUE(message_id)
      );

      CREATE TABLE IF NOT EXISTS application_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER NOT NULL,
        swimlane_id INTEGER NOT NULL,
        changed_by TEXT NOT NULL, -- 'system', 'user', 'email_monitor'
        reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
        FOREIGN KEY (swimlane_id) REFERENCES swimlanes(id)
      );
    `);

		// Create default user if not exists
		const userCount = this.get<{ count: number }>('SELECT COUNT(*) as count FROM users')?.count ?? 0;
		if (userCount === 0) {
			this.run('INSERT INTO users (name, email) VALUES (?, ?)', ['Default User', 'user@example.com']);
		}
	}

	/**
	 * Run a statement (INSERT, UPDATE, DELETE)
	 */
	run(sql: string, params?: any[]): sqlite3.RunResult {
		return this.db.prepare(sql).run(params);
	}

	/**
	 * Get a single row
	 */
	get<T = any>(sql: string, params?: any[]): T | null {
		const result = this.db.prepare(sql).get(params);
		return result as T | null;
	}

	/**
	 * Get all rows
	 */
	all<T = any>(sql: string, params?: any[]): T[] {
		return this.db.prepare(sql).all(params) as T[];
	}

	/**
	 * Close database connection
	 */
	close(): void {
		this.db.close();
	}
}
