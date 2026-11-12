// AI-generated code
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AuthDatabase } from './db.js';

/** Runs schema migrations or makes a consistent SQLite backup. */
async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const command = process.argv[2];
  if (command !== 'migrate' && command !== 'backup') {
    throw new Error('Usage: npm run migrate | npm run backup -- [destination]');
  }
  const path = resolve(process.env.AUTH_DATABASE_PATH ?? './data/auth.sqlite');
  const existing = existsSync(path);
  if (command === 'backup' && !existing) throw new Error('No database exists to back up.');
  const database = new AuthDatabase(path);
  try {
    if (command === 'backup' || existing) {
      const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
      const destination = resolve(process.argv[3] ?? `./backups/auth-${timestamp}.sqlite`);
      if (existsSync(destination)) throw new Error(`Backup already exists: ${destination}`);
      await database.backup(destination);
      process.stdout.write(`Backup created: ${destination}\n`);
    }
    if (command === 'migrate') {
      database.migrate();
      process.stdout.write('Migrations applied.\n');
    }
  } finally {
    database.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
