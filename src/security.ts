// AI-generated code
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';

const lastLimitCleanup = new WeakMap<Database.Database, number>();

/** Creates an unpredictable URL or cookie bearer secret. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Stores only a verifier so a database read does not reveal live bearer tokens. */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Compares secrets without leaking a matching prefix through timing. */
export function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

/** Rejects a request after too many failures within the active window. */
export function isRateLimited(db: Database.Database, key: string, maxFailures: number, windowMs: number): boolean {
  const now = Date.now();
  if (now - (lastLimitCleanup.get(db) ?? 0) >= 60_000) {
    db.prepare('DELETE FROM attempt_limits WHERE reset_at <= ?').run(now);
    lastLimitCleanup.set(db, now);
  }
  const record = db.prepare('SELECT failures, reset_at FROM attempt_limits WHERE key = ?').get(key) as
    | { failures: number; reset_at: number }
    | undefined;
  if (!record || record.reset_at <= now) {
    db.prepare('INSERT INTO attempt_limits (key, failures, reset_at) VALUES (?, 0, ?) ON CONFLICT(key) DO UPDATE SET failures = 0, reset_at = excluded.reset_at').run(key, now + windowMs);
    return false;
  }
  return record.failures >= maxFailures;
}

/** Records a failed attempt against its existing rate-limit window. */
export function recordFailure(db: Database.Database, key: string): void {
  db.prepare('UPDATE attempt_limits SET failures = failures + 1 WHERE key = ?').run(key);
}

/** Clears successful attempts without affecting unrelated users or addresses. */
export function clearFailures(db: Database.Database, key: string): void {
  db.prepare('DELETE FROM attempt_limits WHERE key = ?').run(key);
}
