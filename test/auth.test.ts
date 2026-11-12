// This file contains AI-generated code.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import authPlugin from '../src/plugin.js';
import type { MailSender } from '../src/mailer.js';
import { AuthDatabase } from '../src/db.js';

interface Message {
  to: string;
  subject: string;
  body: string;
}

/** Creates an isolated host with a configurable confirmation destination. */
async function testHost(confirmationRedirectPath = '/auth/profile'): Promise<{ app: FastifyInstance; messages: Message[] }> {
  const messages: Message[] = [];
  const mailer: MailSender = {
    /** Keeps transactional email available for link assertions. */
    async send(to, subject, body) { messages.push({ to, subject, body }); },
  };
  const app = fastify();
  await app.register(authPlugin, {
    databasePath: ':memory:', publicUrl: 'https://example.test', mailer,
    confirmationRedirectPath, onProfileDelete: async () => {},
  });
  app.get('/host-private', async (request, reply) => request.authSession
    ? { accountId: request.authSession.accountId, profileId: request.authSession.activeProfileId }
    : reply.code(401).send({ message: 'Sign in.' }));
  app.get('/member/home', async (request, reply) => request.authSession
    ? { profileId: request.authSession.activeProfileId }
    : reply.code(401).send({ message: 'Sign in.' }));
  await app.ready();
  return { app, messages };
}

/** Sends a same-origin JSON request with an optional session cookie. */
async function post(app: FastifyInstance, path: string, body: object, cookie?: string): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'POST', url: path, headers: {
    origin: 'https://example.test', 'content-type': 'application/json', ...(cookie ? { cookie } : {}),
  }, payload: body });
}

/** Extracts the one-use link from a captured text email. */
function mailLink(message: Message): string {
  const link = message.body.match(/https:\/\/[^\s]+/)?.[0];
  assert.ok(link, 'email contains an action link');
  return link.replace('https://example.test', '');
}

/** Opens a mail link, then performs the user's explicit confirmation. */
async function confirmMailLink(app: FastifyInstance, message: Message, kind: 'verify' | 'email'): Promise<LightMyRequestResponse> {
  const link = new URL(mailLink(message), 'https://example.test');
  assert.equal((await app.inject({ method: 'GET', url: `${link.pathname}${link.search}` })).statusCode, 200);
  return post(app, `/auth/api/${kind}`, { token: link.searchParams.get('token') });
}

/** Returns the browser cookie pair without unrelated response attributes. */
function sessionCookie(response: LightMyRequestResponse): string {
  const header = response.headers['set-cookie'];
  assert.ok(typeof header === 'string');
  return header.split(';')[0]!;
}

test('registration, verification, profiles, switching, and recovery work end to end', async () => {
  const { app, messages } = await testHost();
  try {
    const registered = await post(app, '/auth/api/register', {
      username: 'Owner', email: 'owner@example.test', password: 'a long safe password', profileUsername: 'Fun 😀',
    });
    assert.equal(registered.statusCode, 200);
    assert.equal(messages.length, 1);
    assert.equal((await post(app, '/auth/api/register', {
      username: 'SomeoneElse', email: 'owner@example.test', password: 'another long password', profileUsername: 'SomeoneElse',
    })).statusCode, 200);
    assert.equal(messages.length, 1);
    assert.equal((await post(app, '/auth/api/login', { username: 'owner', password: 'a long safe password' })).statusCode, 401);
    const verifyLink = mailLink(messages[0]!);
    assert.equal((await app.inject({ method: 'GET', url: verifyLink })).statusCode, 200);
    assert.equal((await post(app, '/auth/api/login', { username: 'owner', password: 'a long safe password' })).statusCode, 401);
    assert.equal((await confirmMailLink(app, messages[0]!, 'verify')).statusCode, 200);

    const login = await post(app, '/auth/api/login', { username: 'OWNER', password: 'a long safe password' });
    assert.equal(login.statusCode, 200);
    let cookie = sessionCookie(login);
    const privateBefore = await app.inject({ method: 'GET', url: '/host-private', headers: { cookie } });
    assert.equal(privateBefore.statusCode, 200);
    const initialProfileId = privateBefore.json().profileId as string;

    const added = await post(app, '/auth/api/profiles', { username: 'Learning' }, cookie);
    assert.equal(added.statusCode, 200);
    const secondProfileId = added.json().profile.id as string;
    const switched = await post(app, `/auth/api/profiles/${secondProfileId}/switch`, {}, cookie);
    assert.equal(switched.statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/host-private', headers: { cookie } })).statusCode, 401);
    cookie = sessionCookie(switched);
    assert.equal((await app.inject({ method: 'GET', url: '/host-private', headers: { cookie } })).json().profileId, secondProfileId);
    assert.equal((await post(app, `/auth/api/profiles/${secondProfileId}/rename`, { username: 'Study' }, cookie)).statusCode, 200);
    assert.equal((await post(app, `/auth/api/profiles/${initialProfileId}/delete`, {}, cookie)).statusCode, 200);
    assert.equal((await post(app, `/auth/api/profiles/${secondProfileId}/delete`, {}, cookie)).statusCode, 400);

    assert.equal((await post(app, '/auth/api/forgot', { email: 'owner@example.test' })).statusCode, 200);
    const resetLink = new URL(mailLink(messages.at(-1)! ), 'https://example.test');
    const reset = await post(app, '/auth/api/reset', { token: resetLink.searchParams.get('token'), password: 'a newer safe password' });
    assert.equal(reset.statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/host-private', headers: { cookie } })).statusCode, 401);
    assert.equal((await post(app, '/auth/api/login', { username: 'owner', password: 'a newer safe password' })).statusCode, 200);
    assert.equal((await post(app, '/auth/api/reset', { token: resetLink.searchParams.get('token'), password: 'another safe password' })).statusCode, 400);
  } finally { await app.close(); }
});

test('unowned profiles and cross-origin requests are rejected', async () => {
  const { app, messages } = await testHost();
  try {
    for (const username of ['Alpha', 'Beta']) {
      assert.equal((await post(app, '/auth/api/register', {
        username, email: `${username.toLowerCase()}@example.test`, password: 'a long safe password', profileUsername: `${username}Profile`,
      })).statusCode, 200);
      assert.equal((await confirmMailLink(app, messages.at(-1)!, 'verify')).statusCode, 200);
    }
    const alpha = sessionCookie(await post(app, '/auth/api/login', { username: 'Alpha', password: 'a long safe password' }));
    const beta = sessionCookie(await post(app, '/auth/api/login', { username: 'Beta', password: 'a long safe password' }));
    const betaId = (await app.inject({ method: 'GET', url: '/auth/api/me', headers: { cookie: beta } })).json().activeProfileId as string;
    assert.equal((await post(app, `/auth/api/profiles/${betaId}/switch`, {}, alpha)).statusCode, 404);
    assert.equal((await post(app, `/auth/api/profiles/${betaId}/delete`, {}, alpha)).statusCode, 404);
    const forged = await app.inject({ method: 'POST', url: '/auth/api/profiles', headers: {
      origin: 'https://other.test', 'content-type': 'application/json', cookie: alpha,
    }, payload: { username: 'Forged' } });
    assert.equal(forged.statusCode, 403);
  } finally { await app.close(); }
});

test('sensitive account changes require a password and revoke old sessions', async () => {
  const { app, messages } = await testHost();
  try {
    await post(app, '/auth/api/register', {
      username: 'Owner', email: 'owner@example.test', password: 'a long safe password', profileUsername: 'Fun',
    });
    await confirmMailLink(app, messages[0]!, 'verify');
    const cookie = sessionCookie(await post(app, '/auth/api/login', { username: 'Owner', password: 'a long safe password' }));
    const profilePage = await app.inject({ method: 'GET', url: '/auth/profile', headers: { cookie } });
    assert.match(profilePage.body, /Enter your current password only for the change you are making/);
    assert.equal((await post(app, '/auth/api/account/username', { username: 'Renamed', password: 'wrong' }, cookie)).statusCode, 401);
    assert.equal((await post(app, '/auth/api/account/username', { username: 'Renamed', password: 'a long safe password' }, cookie)).statusCode, 200);
    assert.equal((await post(app, '/auth/api/account/email', { email: 'new@example.test', password: 'wrong' }, cookie)).statusCode, 401);
    assert.equal((await post(app, '/auth/api/account/email', { email: 'new@example.test', password: 'a long safe password' }, cookie)).statusCode, 200);
    assert.equal(messages.at(-1)?.to, 'new@example.test');
    assert.equal((await confirmMailLink(app, messages.at(-1)!, 'email')).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/auth/api/me', headers: { cookie } })).statusCode, 401);
    const nextCookie = sessionCookie(await post(app, '/auth/api/login', { username: 'renamed', password: 'a long safe password' }));
    assert.equal((await app.inject({ method: 'GET', url: '/auth/api/me', headers: { cookie: nextCookie } })).json().email, 'new@example.test');
    assert.equal((await post(app, '/auth/api/account/password', { oldPassword: 'a long safe password', newPassword: 'a newer safe password' }, nextCookie)).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/auth/api/me', headers: { cookie: nextCookie } })).statusCode, 401);
    assert.equal((await post(app, '/auth/api/login', { username: 'Renamed', password: 'a long safe password' })).statusCode, 401);
    assert.equal((await post(app, '/auth/api/login', { username: 'Renamed', password: 'a newer safe password' })).statusCode, 200);
  } finally { await app.close(); }
});

test('email confirmation continues to an administrator-selected page after sign-in', async () => {
  const { app, messages } = await testHost('/member/home');
  try {
    await post(app, '/auth/api/register', {
      username: 'Owner', email: 'owner@example.test', password: 'a long safe password', profileUsername: 'Personal',
    });
    const confirmation = await app.inject({ method: 'GET', url: mailLink(messages[0]!) });
    assert.match(confirmation.body, /data-next="\/auth\/continue"/);
    assert.equal((await confirmMailLink(app, messages[0]!, 'verify')).statusCode, 200);
    const continuation = await app.inject({ method: 'GET', url: '/auth/continue' });
    assert.equal(continuation.statusCode, 302);
    assert.equal(continuation.headers.location, '/auth/login?next=%2Fmember%2Fhome');
    const signIn = await app.inject({ method: 'GET', url: continuation.headers.location });
    assert.match(signIn.body, /data-next="\/member\/home"/);
    const loggedIn = await post(app, '/auth/api/login', { username: 'Owner', password: 'a long safe password' });
    assert.equal((await app.inject({ method: 'GET', url: '/member/home', headers: { cookie: sessionCookie(loggedIn) } })).statusCode, 200);
    const unsafe = await app.inject({ method: 'GET', url: '/auth/login?next=https://other.test' });
    assert.match(unsafe.body, /data-next="\/auth\/profile"/);
  } finally { await app.close(); }
});

test('administrator confirmation destinations cannot leave the site', async () => {
  const app = fastify();
  try {
    await assert.rejects(async () => {
      await app.register(authPlugin, {
        databasePath: ':memory:', publicUrl: 'https://example.test',
        confirmationRedirectPath: 'https://other.test/steal',
        mailer: { async send() {} },
      });
    }, /same-origin absolute path/);
  } finally { await app.close(); }
});

test('visible Unicode names are bounded and a live SQLite database can be backed up', async () => {
  const { app } = await testHost();
  try {
    assert.equal((await post(app, '/auth/api/register', {
      username: 'invisi\u200bble', email: 'one@example.test', password: 'a long safe password', profileUsername: 'First',
    })).statusCode, 400);
    assert.equal((await post(app, '/auth/api/register', {
      username: 'x'.repeat(33), email: 'one@example.test', password: 'a long safe password', profileUsername: 'First',
    })).statusCode, 400);
    const page = await app.inject({ method: 'GET', url: '/auth/register' });
    assert.equal(page.statusCode, 200);
    assert.match(String(page.headers['content-security-policy']), /script-src 'self'/);
  } finally { await app.close(); }

  const directory = mkdtempSync(join(tmpdir(), 'auth-backup-'));
  const backupPath = join(directory, 'snapshot.sqlite');
  const database = new AuthDatabase(':memory:');
  try {
    database.migrate();
    await database.backup(backupPath);
    const restored = new AuthDatabase(backupPath);
    try { assert.equal(restored.hasPendingMigrations(), false); }
    finally { restored.close(); }
  } finally {
    database.close();
    unlinkSync(backupPath);
    rmdirSync(directory);
  }
});
