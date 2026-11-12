// AI-generated code
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        login_username TEXT NOT NULL,
        login_key TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        email_key TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        verified_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE profiles (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        username TEXT NOT NULL,
        username_key TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX profiles_account_id ON profiles(account_id);
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        active_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX sessions_account_id ON sessions(account_id);
      CREATE TABLE action_tokens (
        token_hash TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        pending_email TEXT,
        pending_email_key TEXT,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX action_tokens_account_kind ON action_tokens(account_id, kind);
      CREATE TABLE attempt_limits (
        key TEXT PRIMARY KEY,
        failures INTEGER NOT NULL,
        reset_at INTEGER NOT NULL
      );
      CREATE INDEX attempt_limits_reset_at ON attempt_limits(reset_at);
    `,
  },
];

/** Owns the SQLite connection and applies numbered schema changes atomically. */
export class AuthDatabase {
  readonly connection: Database.Database;

  /** Opens a persistent database and enables constraints and concurrent readers. */
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.connection = new Database(path);
    this.connection.pragma('journal_mode = WAL');
    this.connection.pragma('foreign_keys = ON');
  }

  /** Reports whether the file has a migration still to apply. */
  hasPendingMigrations(): boolean {
    const table = this.connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
    if (!table) return migrations.length > 0;
    const applied = new Set(
      this.connection.prepare('SELECT version FROM schema_migrations').all().map((row) => (row as { version: number }).version),
    );
    return migrations.some((migration) => !applied.has(migration.version));
  }

  /** Applies pending migrations once, recording each successful version. */
  migrate(): void {
    this.connection.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
    const applied = new Set(
      this.connection.prepare('SELECT version FROM schema_migrations').all().map((row) => (row as { version: number }).version),
    );
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      this.connection.transaction(() => {
        this.connection.exec(migration.sql);
        this.connection.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(migration.version, Date.now());
      })();
    }
  }

  /** Copies a consistent snapshot of a live database to a separate file. */
  async backup(destination: string): Promise<void> {
    mkdirSync(dirname(destination), { recursive: true });
    await this.connection.backup(destination);
  }

  /** Releases the SQLite connection after the server or CLI finishes. */
  close(): void {
    this.connection.close();
  }
}
