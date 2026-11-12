// AI-generated code
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import type Database from 'better-sqlite3';
import { AuthDatabase } from './db.js';
import { emailKey, usernameKey, validateEmail, validatePassword, validateUsername } from './identity.js';
import type { MailSender } from './mailer.js';
import { clearFailures, isRateLimited, newToken, recordFailure, tokenHash } from './security.js';

const SESSION_IDLE_MS = 30 * 60 * 1000;
const SESSION_MAX_MS = 8 * 60 * 60 * 1000;
const passwordHashOptions = { type: argon2.argon2id, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 } as const;
const dummyHash = argon2.hash('This is a timing equalizer, not a real account password.', passwordHashOptions);

interface AccountRow {
  id: string;
  login_username: string;
  email: string;
  password_hash: string;
  verified_at: number | null;
}

interface ProfileRow {
  id: string;
  account_id: string;
  username: string;
}

interface ActionTokenRow {
  account_id: string;
  kind: string;
  pending_email: string | null;
  pending_email_key: string | null;
  expires_at: number;
}

export interface SessionView {
  accountId: string;
  loginUsername: string;
  email: string;
  activeProfileId: string;
  activeProfileUsername: string;
}

export interface ProfileView {
  id: string;
  username: string;
}

export class AuthError extends Error {
  /** Carries a safe client-facing message and HTTP status. */
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Implements account and profile operations independently of Fastify routes. */
export class AuthService {
  private readonly db: Database.Database;

  /** Uses a site-specific database, mail sender, and public URL. */
  constructor(database: AuthDatabase, private readonly mailer: MailSender, private readonly publicUrl: string, private readonly basePath = '/auth') {
    this.db = database.connection;
  }

  /** Creates an unverified account with its first user-named profile. */
  async register(loginInput: unknown, emailInput: unknown, passwordInput: unknown, profileInput: unknown): Promise<void> {
    const login = validateUsername(loginInput);
    const email = validateEmail(emailInput);
    const profile = validateUsername(profileInput);
    if (!login || !email || !profile || !validatePassword(passwordInput)) {
      throw new AuthError('Use valid names, an email address, and a password of at least 15 characters.', 400);
    }
    const accountId = randomUUID();
    const profileId = randomUUID();
    const now = Date.now();
    const hash = await argon2.hash(passwordInput, passwordHashOptions);
    const actionToken = newToken();
    try {
      this.db.transaction(() => {
        this.db.prepare('INSERT INTO accounts (id, login_username, login_key, email, email_key, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(accountId, login, usernameKey(login), email, emailKey(email), hash, now);
        this.db.prepare('INSERT INTO profiles (id, account_id, username, username_key, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(profileId, accountId, profile, usernameKey(profile), now);
        this.db.prepare('INSERT INTO action_tokens (token_hash, account_id, kind, expires_at) VALUES (?, ?, ?, ?)')
          .run(tokenHash(actionToken), accountId, 'verify', now + 24 * 60 * 60 * 1000);
      })();
    } catch (error) {
      // Existing emails get the same public registration response as new ones.
      if (error instanceof Error && error.message.includes('accounts.email_key')) return;
      if (this.isUniqueError(error)) throw new AuthError('These account details are unavailable.', 409);
      throw error;
    }
    await this.mailer.send(email, 'Verify your email', `Open this link to verify your email:\n${this.actionUrl('verify', actionToken)}\n\nThis link expires in 24 hours.`);
  }

  /** Sends another verification link without revealing whether an account exists. */
  async resendVerification(emailInput: unknown): Promise<void> {
    const email = validateEmail(emailInput);
    if (!email) return;
    const account = this.db.prepare('SELECT * FROM accounts WHERE email_key = ?').get(emailKey(email)) as AccountRow | undefined;
    if (!account || account.verified_at) return;
    const token = this.replaceActionToken(account.id, 'verify', 24 * 60 * 60 * 1000);
    await this.mailer.send(account.email, 'Verify your email', `Open this link to verify your email:\n${this.actionUrl('verify', token)}\n\nThis link expires in 24 hours.`);
  }

  /** Consumes a one-use link and marks the account's current address verified. */
  verifyEmail(token: unknown): void {
    const action = this.getActionToken(token, 'verify');
    if (!action) throw new AuthError('This verification link is invalid or expired.', 400);
    this.db.transaction(() => {
      this.consumeActionToken(token as string, 'verify');
      this.db.prepare('UPDATE accounts SET verified_at = ? WHERE id = ?').run(Date.now(), action.account_id);
    })();
  }

  /** Authenticates a verified account and starts a server-managed session. */
  async login(loginInput: unknown, passwordInput: unknown, ip: string): Promise<string> {
    const login = typeof loginInput === 'string' ? loginInput : '';
    const password = typeof passwordInput === 'string' ? passwordInput : '';
    const limitKey = `login:${ip}:${tokenHash(usernameKey(login))}`;
    const accountLimitKey = `login-name:${tokenHash(usernameKey(login))}`;
    if (isRateLimited(this.db, limitKey, 5, 15 * 60 * 1000)
      || isRateLimited(this.db, accountLimitKey, 10, 15 * 60 * 1000)) {
      throw new AuthError('Too many attempts. Try again later.', 429);
    }
    const account = this.db.prepare('SELECT * FROM accounts WHERE login_key = ?').get(usernameKey(login)) as AccountRow | undefined;
    const valid = await argon2.verify(account?.password_hash ?? await dummyHash, password).catch(() => false);
    if (!account || !valid || !account.verified_at) {
      recordFailure(this.db, limitKey);
      recordFailure(this.db, accountLimitKey);
      throw new AuthError('Invalid login details.', 401);
    }
    clearFailures(this.db, limitKey);
    clearFailures(this.db, accountLimitKey);
    const firstProfile = this.db.prepare('SELECT * FROM profiles WHERE account_id = ? ORDER BY created_at, id LIMIT 1').get(account.id) as ProfileRow | undefined;
    if (!firstProfile) throw new AuthError('This account has no profile.', 500);
    return this.createSession(account.id, firstProfile.id);
  }

  /** Resolves a live cookie to account and active-profile data. */
  session(cookieToken: string | undefined): SessionView | null {
    if (!cookieToken) return null;
    const now = Date.now();
    const row = this.db.prepare(`
      SELECT s.account_id, s.active_profile_id, s.last_seen_at, s.expires_at,
             a.login_username, a.email, p.username AS profile_username
      FROM sessions s JOIN accounts a ON a.id = s.account_id
      JOIN profiles p ON p.id = s.active_profile_id AND p.account_id = s.account_id
      WHERE s.token_hash = ?
    `).get(tokenHash(cookieToken)) as {
      account_id: string; active_profile_id: string; last_seen_at: number; expires_at: number;
      login_username: string; email: string; profile_username: string;
    } | undefined;
    if (!row) return null;
    if (row.expires_at <= now || row.last_seen_at + SESSION_IDLE_MS <= now) {
      this.logout(cookieToken);
      return null;
    }
    if (now - row.last_seen_at > 60_000) {
      this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(now, tokenHash(cookieToken));
    }
    return {
      accountId: row.account_id,
      loginUsername: row.login_username,
      email: row.email,
      activeProfileId: row.active_profile_id,
      activeProfileUsername: row.profile_username,
    };
  }

  /** Invalidates a bearer token on the server. */
  logout(cookieToken: string | undefined): void {
    if (cookieToken) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(cookieToken));
  }

  /** Returns only profiles belonging to the authenticated account. */
  profiles(accountId: string): ProfileView[] {
    return this.db.prepare('SELECT id, username FROM profiles WHERE account_id = ? ORDER BY created_at, id').all(accountId) as ProfileView[];
  }

  /** Adds a distinct public persona under the same owner account. */
  createProfile(accountId: string, usernameInput: unknown): ProfileView {
    const username = validateUsername(usernameInput);
    if (!username) throw new AuthError('Use a visible username of at most 32 characters.', 400);
    const profile = { id: randomUUID(), username };
    try {
      this.db.prepare('INSERT INTO profiles (id, account_id, username, username_key, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(profile.id, accountId, username, usernameKey(username), Date.now());
    } catch (error) {
      if (this.isUniqueError(error)) throw new AuthError('That profile name is unavailable.', 409);
      throw error;
    }
    return profile;
  }

  /** Renames a profile only when it belongs to the current account. */
  renameProfile(accountId: string, profileId: string, usernameInput: unknown): void {
    const username = validateUsername(usernameInput);
    if (!username) throw new AuthError('Use a visible username of at most 32 characters.', 400);
    try {
      const result = this.db.prepare('UPDATE profiles SET username = ?, username_key = ? WHERE id = ? AND account_id = ?')
        .run(username, usernameKey(username), profileId, accountId);
      if (!result.changes) throw new AuthError('Profile not found.', 404);
    } catch (error) {
      if (this.isUniqueError(error)) throw new AuthError('That profile name is unavailable.', 409);
      throw error;
    }
  }

  /** Deletes a profile while keeping every session pointed at an owned profile. */
  deleteProfile(accountId: string, profileId: string): void {
    this.db.transaction(() => {
      const profiles = this.profiles(accountId);
      if (!profiles.some((profile) => profile.id === profileId)) throw new AuthError('Profile not found.', 404);
      if (profiles.length === 1) throw new AuthError('An account must keep one profile.', 400);
      const replacement = profiles.find((profile) => profile.id !== profileId)!;
      this.db.prepare('UPDATE sessions SET active_profile_id = ? WHERE account_id = ? AND active_profile_id = ?')
        .run(replacement.id, accountId, profileId);
      this.db.prepare('DELETE FROM profiles WHERE id = ? AND account_id = ?').run(profileId, accountId);
    })();
  }

  /** Switches the active persona and rotates the session bearer token. */
  switchProfile(accountId: string, cookieToken: string, profileId: string): string {
    const owned = this.db.prepare('SELECT id FROM profiles WHERE id = ? AND account_id = ?').get(profileId, accountId);
    if (!owned) throw new AuthError('Profile not found.', 404);
    const replacement = newToken();
    this.db.transaction(() => {
      const result = this.db.prepare('UPDATE sessions SET token_hash = ?, active_profile_id = ?, last_seen_at = ? WHERE token_hash = ? AND account_id = ?')
        .run(tokenHash(replacement), profileId, Date.now(), tokenHash(cookieToken), accountId);
      if (!result.changes) throw new AuthError('Session expired.', 401);
    })();
    return replacement;
  }

  /** Sends a one-use reset link with the same public response for every email. */
  async requestPasswordReset(emailInput: unknown): Promise<void> {
    const email = validateEmail(emailInput);
    if (!email) return;
    const account = this.db.prepare('SELECT * FROM accounts WHERE email_key = ?').get(emailKey(email)) as AccountRow | undefined;
    if (!account || !account.verified_at) return;
    const token = this.replaceActionToken(account.id, 'reset', 30 * 60 * 1000);
    await this.mailer.send(account.email, 'Reset your password', `Open this link to reset your password:\n${this.actionUrl('reset', token)}\n\nThis link expires in 30 minutes.`);
  }

  /** Changes a password with a valid reset link and revokes old sessions. */
  async resetPassword(token: unknown, passwordInput: unknown): Promise<void> {
    if (!validatePassword(passwordInput)) throw new AuthError('Use a password of at least 15 characters.', 400);
    const action = this.getActionToken(token, 'reset');
    if (!action) throw new AuthError('This reset link is invalid or expired.', 400);
    const hash = await argon2.hash(passwordInput, passwordHashOptions);
    this.db.transaction(() => {
      this.consumeActionToken(token as string, 'reset');
      this.db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(hash, action.account_id);
      this.db.prepare('DELETE FROM sessions WHERE account_id = ?').run(action.account_id);
    })();
  }

  /** Changes a login name after confirming the current password. */
  async changeLoginUsername(accountId: string, passwordInput: unknown, loginInput: unknown): Promise<void> {
    const login = validateUsername(loginInput);
    if (!login) throw new AuthError('Use a visible username of at most 32 characters.', 400);
    await this.requirePassword(accountId, passwordInput);
    try {
      this.db.prepare('UPDATE accounts SET login_username = ?, login_key = ? WHERE id = ?')
        .run(login, usernameKey(login), accountId);
    } catch (error) {
      if (this.isUniqueError(error)) throw new AuthError('That login name is unavailable.', 409);
      throw error;
    }
  }

  /** Sends a confirmation link to a new email after password reauthentication. */
  async requestEmailChange(accountId: string, passwordInput: unknown, emailInput: unknown): Promise<void> {
    const email = validateEmail(emailInput);
    if (!email) throw new AuthError('Enter a valid email address.', 400);
    await this.requirePassword(accountId, passwordInput);
    const existing = this.db.prepare('SELECT id FROM accounts WHERE email_key = ?').get(emailKey(email)) as { id: string } | undefined;
    if (existing && existing.id !== accountId) throw new AuthError('That email is unavailable.', 409);
    const token = this.replaceActionToken(accountId, 'email', 60 * 60 * 1000, email);
    await this.mailer.send(email, 'Confirm your new email', `Open this link to confirm your new email:\n${this.actionUrl('email', token)}\n\nThis link expires in one hour.`);
  }

  /** Confirms an email change and revokes sessions so it cannot be silently reused. */
  confirmEmailChange(token: unknown): void {
    const action = this.getActionToken(token, 'email');
    if (!action || !action.pending_email || !action.pending_email_key) throw new AuthError('This confirmation link is invalid or expired.', 400);
    try {
      this.db.transaction(() => {
        this.consumeActionToken(token as string, 'email');
        this.db.prepare('UPDATE accounts SET email = ?, email_key = ?, verified_at = ? WHERE id = ?')
          .run(action.pending_email, action.pending_email_key, Date.now(), action.account_id);
        this.db.prepare('DELETE FROM sessions WHERE account_id = ?').run(action.account_id);
        this.db.prepare('DELETE FROM action_tokens WHERE account_id = ? AND kind = ?').run(action.account_id, 'email');
      })();
    } catch (error) {
      if (this.isUniqueError(error)) throw new AuthError('That email is unavailable.', 409);
      throw error;
    }
  }

  /** Updates a password after checking the old one and invalidates all sessions. */
  async changePassword(accountId: string, oldInput: unknown, newInput: unknown): Promise<void> {
    if (!validatePassword(newInput)) throw new AuthError('Use a password of at least 15 characters.', 400);
    await this.requirePassword(accountId, oldInput);
    const hash = await argon2.hash(newInput, passwordHashOptions);
    this.db.transaction(() => {
      this.db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(hash, accountId);
      this.db.prepare('DELETE FROM sessions WHERE account_id = ?').run(accountId);
    })();
  }

  /** Creates a session with an unguessable cookie and only its hash in storage. */
  private createSession(accountId: string, profileId: string): string {
    const token = newToken();
    const now = Date.now();
    this.db.prepare('INSERT INTO sessions (token_hash, account_id, active_profile_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(tokenHash(token), accountId, profileId, now, now, now + SESSION_MAX_MS);
    return token;
  }

  /** Replaces older links of the same kind to make only the newest one usable. */
  private replaceActionToken(accountId: string, kind: string, lifetimeMs: number, pendingEmail?: string): string {
    const token = newToken();
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM action_tokens WHERE account_id = ? AND kind = ?').run(accountId, kind);
      this.db.prepare('INSERT INTO action_tokens (token_hash, account_id, kind, pending_email, pending_email_key, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(tokenHash(token), accountId, kind, pendingEmail ?? null, pendingEmail ? emailKey(pendingEmail) : null, Date.now() + lifetimeMs);
    })();
    return token;
  }

  /** Reads only a live action link of the expected purpose. */
  private getActionToken(token: unknown, kind: string): ActionTokenRow | null {
    if (typeof token !== 'string' || token.length > 128) return null;
    const action = this.db.prepare('SELECT account_id, kind, pending_email, pending_email_key, expires_at FROM action_tokens WHERE token_hash = ?')
      .get(tokenHash(token)) as ActionTokenRow | undefined;
    return action?.kind === kind && action.expires_at > Date.now() ? action : null;
  }

  /** Claims a link inside the surrounding transaction so parallel uses cannot both succeed. */
  private consumeActionToken(token: string, kind: string): void {
    const result = this.db.prepare('DELETE FROM action_tokens WHERE token_hash = ? AND kind = ? AND expires_at > ?')
      .run(tokenHash(token), kind, Date.now());
    if (!result.changes) throw new AuthError('This link is invalid or expired.', 400);
  }

  /** Rejects sensitive changes unless the account password is supplied again. */
  private async requirePassword(accountId: string, passwordInput: unknown): Promise<void> {
    const limitKey = `reauth:${accountId}`;
    if (isRateLimited(this.db, limitKey, 5, 15 * 60 * 1000)) throw new AuthError('Too many attempts. Try again later.', 429);
    const account = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as AccountRow | undefined;
    const valid = account && typeof passwordInput === 'string' && await argon2.verify(account.password_hash, passwordInput);
    if (!valid) {
      recordFailure(this.db, limitKey);
      throw new AuthError('Current password is incorrect.', 401);
    }
    clearFailures(this.db, limitKey);
  }

  /** Constructs a link only beneath the configured site origin. */
  private actionUrl(kind: string, token: string): string {
    const url = new URL(`${this.basePath}/${kind}`, this.publicUrl);
    url.searchParams.set('token', token);
    return url.toString();
  }

  /** Identifies a uniqueness violation without exposing database details to users. */
  private isUniqueError(error: unknown): boolean {
    return error instanceof Error && error.message.includes('UNIQUE constraint failed');
  }
}
