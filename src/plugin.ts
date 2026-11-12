// This file contains AI-generated code.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { AuthDatabase } from './db.js';
import { AuthError, AuthService, type SessionView } from './auth.js';
import { emailKey } from './identity.js';
import type { MailSender } from './mailer.js';
import { isRateLimited, recordFailure, tokenHash } from './security.js';
import { clientJs, confirmationPage, defaultCss, emailRequestPage, loginPage, profilePage, registerPage, resetPage, resultPage } from './pages.js';

declare module 'fastify' {
  interface FastifyRequest {
    authSession: SessionView | null;
  }
}

export interface AuthPluginOptions {
  databasePath: string;
  publicUrl: string;
  mailer: MailSender;
  secureCookies?: boolean;
  basePath?: string;
  customCssUrl?: string;
  confirmationRedirectPath?: string;
  onProfileDelete?: (accountId: string, profileId: string) => Promise<void>;
}

/** Restricts administrator-configured navigation to a canonical path on this site. */
function localRedirectPath(path: string, origin: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new Error('confirmationRedirectPath must be a same-origin absolute path');
  }
  const parsed = new URL(path, origin);
  if (parsed.origin !== origin || parsed.pathname !== path || parsed.search || parsed.hash) {
    throw new Error('confirmationRedirectPath must be a same-origin absolute path without a query or fragment');
  }
  return path;
}

/** Reads only the configured, host-scoped session cookie. */
function cookieToken(request: FastifyRequest, cookieName: string): string | undefined {
  const cookieHeader = request.headers.cookie;
  const pair = cookieHeader?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`));
  const value = pair?.slice(cookieName.length + 1);
  return value && /^[A-Za-z0-9_-]{40,60}$/.test(value) ? value : undefined;
}

/** Sets an HTTP-only browser session restricted to this site's host. */
function setSessionCookie(reply: FastifyReply, name: string, token: string, secure: boolean): void {
  reply.header('set-cookie', `${name}=${token}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
}

/** Removes the browser copy after server-side invalidation. */
function clearSessionCookie(reply: FastifyReply, name: string, secure: boolean): void {
  reply.header('set-cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`);
}

/** Returns a safe body property without trusting the JSON shape. */
function field(request: FastifyRequest, name: string): unknown {
  const body = request.body;
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>)[name] : undefined;
}

/** Requires an authenticated session for account and profile operations. */
function signedIn(request: FastifyRequest): SessionView {
  if (!request.authSession) throw new AuthError('Sign in to continue.', 401);
  return request.authSession;
}

/** Spends a persistent request allowance for an abuse-prone endpoint. */
function takeQuota(database: AuthDatabase, key: string, maximum: number, windowMs: number): void {
  if (isRateLimited(database.connection, key, maximum, windowMs)) throw new AuthError('Too many requests. Try again later.', 429);
  recordFailure(database.connection, key);
}

/** Registers browser pages and JSON operations with scoped error handling. */
const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (app, options) => {
  const basePath = options.basePath ?? '/auth';
  if (!/^\/[a-z0-9/_-]+$/i.test(basePath) || basePath.endsWith('/') || basePath.includes('//')) {
    throw new Error('basePath must be a simple absolute path without a trailing slash');
  }
  if (options.customCssUrl && (!options.customCssUrl.startsWith('/') || options.customCssUrl.startsWith('//'))) {
    throw new Error('customCssUrl must be a same-origin absolute path');
  }
  const siteOrigin = new URL(options.publicUrl).origin;
  const confirmationRedirectPath = localRedirectPath(options.confirmationRedirectPath ?? `${basePath}/profile`, siteOrigin);
  const secure = options.secureCookies ?? true;
  if (secure && !siteOrigin.startsWith('https://')) throw new Error('Secure cookies require an HTTPS publicUrl');
  const cookieName = secure ? '__Host-site_auth' : 'site_auth_dev';
  const databaseExisted = existsSync(options.databasePath);
  const database = new AuthDatabase(options.databasePath);
  if (databaseExisted && database.hasPendingMigrations()) {
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
    await database.backup(join(dirname(options.databasePath), 'backups', `pre-migration-${timestamp}.sqlite`));
  }
  database.migrate();
  const service = new AuthService(database, options.mailer, options.publicUrl, basePath);

  app.decorateRequest('authSession', null);
  app.addHook('onRequest', async (request) => {
    request.authSession = service.session(cookieToken(request, cookieName));
  });
  app.addHook('onClose', async () => database.close());

  // Child scope keeps authentication errors and origin policy off unrelated host routes.
  app.register(async (routes) => {
    routes.addHook('onRequest', async (request, reply) => {
      reply.header('cache-control', 'no-store');
      if (request.method === 'POST') {
        const origin = request.headers.origin;
        if (origin !== siteOrigin || !request.headers['content-type']?.startsWith('application/json')) {
          throw new AuthError('Request origin or content type is not allowed.', 403);
        }
      }
    });
    routes.addHook('onSend', async (_request, reply, payload) => {
      reply.header('x-content-type-options', 'nosniff');
      reply.header('referrer-policy', 'no-referrer');
      reply.header('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
      return payload;
    });
    routes.setErrorHandler((error, request, reply) => {
      if (error instanceof AuthError) {
        if (request.url.startsWith(`${basePath}/api/login`)) {
          request.log.warn({ statusCode: error.status }, 'sign-in rejected');
        }
        if (request.url.includes('/api/')) return reply.code(error.status).send({ message: error.message });
        return reply.code(error.status).type('text/html').send(resultPage('Unable to continue', error.message, basePath, options.customCssUrl));
      }
      request.log.error(error, 'authentication route failed');
      if (request.url.includes('/api/')) return reply.code(500).send({ message: 'Something went wrong.' });
      return reply.code(500).type('text/html').send(resultPage('Unable to continue', 'Something went wrong.', basePath, options.customCssUrl));
    });

    routes.get(basePath, async (_request, reply) => reply.redirect(`${basePath}/login`));
    routes.get(`${basePath}/assets/default.css`, async (_request, reply) => reply.type('text/css').send(defaultCss));
    routes.get(`${basePath}/assets/app.js`, async (_request, reply) => reply.type('application/javascript').send(clientJs));
    routes.get(`${basePath}/login`, async (request, reply) => {
      const requestedNext = (request.query as { next?: string }).next;
      const nextPath = requestedNext === confirmationRedirectPath ? confirmationRedirectPath : `${basePath}/profile`;
      return request.authSession
        ? reply.redirect(nextPath)
        : reply.type('text/html').send(loginPage(basePath, nextPath, options.customCssUrl));
    });
    routes.get(`${basePath}/continue`, async (request, reply) => request.authSession
      ? reply.redirect(confirmationRedirectPath)
      : reply.redirect(`${basePath}/login?next=${encodeURIComponent(confirmationRedirectPath)}`));
    routes.get(`${basePath}/register`, async (_request, reply) => reply.type('text/html').send(registerPage(basePath, options.customCssUrl)));
    routes.get(`${basePath}/forgot`, async (_request, reply) => reply.type('text/html').send(emailRequestPage('forgot', basePath, options.customCssUrl)));
    routes.get(`${basePath}/resend`, async (_request, reply) => reply.type('text/html').send(emailRequestPage('resend', basePath, options.customCssUrl)));
    routes.get(`${basePath}/reset`, async (request, reply) => reply.type('text/html').send(resetPage((request.query as { token?: string }).token ?? '', basePath, options.customCssUrl)));
    routes.get(`${basePath}/verify`, async (request, reply) => reply.type('text/html').send(confirmationPage('verify', (request.query as { token?: string }).token ?? '', basePath, options.customCssUrl)));
    routes.get(`${basePath}/email`, async (request, reply) => reply.type('text/html').send(confirmationPage('email', (request.query as { token?: string }).token ?? '', basePath, options.customCssUrl)));
    routes.get(`${basePath}/profile`, async (request, reply) => {
      if (!request.authSession) return reply.redirect(`${basePath}/login`);
      return reply.type('text/html').send(profilePage(request.authSession, service.profiles(request.authSession.accountId), basePath, options.customCssUrl, !!options.onProfileDelete));
    });

    routes.post(`${basePath}/api/register`, async (request) => {
      takeQuota(database, `register:${request.ip}`, 5, 60 * 60 * 1000);
      await service.register(field(request, 'username'), field(request, 'email'), field(request, 'password'), field(request, 'profileUsername'));
      request.log.info('account registration requested');
      return { message: 'Check your email for a verification link.' };
    });
    routes.post(`${basePath}/api/resend`, async (request) => {
      takeQuota(database, `resend:${request.ip}`, 5, 60 * 60 * 1000);
      const email = field(request, 'email');
      if (typeof email === 'string') takeQuota(database, `resend-address:${tokenHash(emailKey(email))}`, 5, 60 * 60 * 1000);
      await service.resendVerification(field(request, 'email'));
      return { message: 'If the address belongs to an unverified account, a link is on its way.' };
    });
    routes.post(`${basePath}/api/verify`, async (request, reply) => {
      service.verifyEmail(field(request, 'token'));
      service.logout(cookieToken(request, cookieName));
      clearSessionCookie(reply, cookieName, secure);
      return { message: 'Email verified. You can now sign in.' };
    });
    routes.post(`${basePath}/api/email`, async (request, reply) => {
      service.confirmEmailChange(field(request, 'token'));
      service.logout(cookieToken(request, cookieName));
      clearSessionCookie(reply, cookieName, secure);
      return { message: 'Email changed. Sign in again.' };
    });
    routes.post(`${basePath}/api/login`, async (request, reply) => {
      takeQuota(database, `login-ip:${request.ip}`, 30, 15 * 60 * 1000);
      const token = await service.login(field(request, 'username'), field(request, 'password'), request.ip);
      setSessionCookie(reply, cookieName, token, secure);
      request.log.info('account signed in');
      return { message: 'Signed in.' };
    });
    routes.post(`${basePath}/api/logout`, async (request, reply) => {
      service.logout(cookieToken(request, cookieName));
      clearSessionCookie(reply, cookieName, secure);
      return { message: 'Signed out.' };
    });
    routes.post(`${basePath}/api/forgot`, async (request) => {
      takeQuota(database, `forgot:${request.ip}`, 5, 60 * 60 * 1000);
      const email = field(request, 'email');
      if (typeof email === 'string') takeQuota(database, `forgot-address:${tokenHash(emailKey(email))}`, 5, 60 * 60 * 1000);
      await service.requestPasswordReset(field(request, 'email'));
      return { message: 'If the address belongs to an account, a reset link is on its way.' };
    });
    routes.post(`${basePath}/api/reset`, async (request) => {
      takeQuota(database, `reset:${request.ip}`, 10, 60 * 60 * 1000);
      await service.resetPassword(field(request, 'token'), field(request, 'password'));
      return { message: 'Password reset. Sign in again.' };
    });
    routes.get(`${basePath}/api/me`, async (request) => {
      const session = signedIn(request);
      return { ...session, profiles: service.profiles(session.accountId) };
    });
    routes.post(`${basePath}/api/profiles`, async (request) => {
      const session = signedIn(request);
      takeQuota(database, `profile-create:${session.accountId}`, 20, 60 * 60 * 1000);
      return { message: 'Profile created.', profile: service.createProfile(session.accountId, field(request, 'username')) };
    });
    routes.post(`${basePath}/api/profiles/:id/rename`, async (request) => {
      const session = signedIn(request);
      service.renameProfile(session.accountId, (request.params as { id: string }).id, field(request, 'username'));
      return { message: 'Profile renamed.' };
    });
    routes.post(`${basePath}/api/profiles/:id/delete`, async (request) => {
      const session = signedIn(request);
      const profileId = (request.params as { id: string }).id;
      if (!options.onProfileDelete) throw new AuthError('Profile deletion is not configured for this site.', 501);
      const ownedProfiles = service.profiles(session.accountId);
      if (!ownedProfiles.some((profile) => profile.id === profileId)) throw new AuthError('Profile not found.', 404);
      if (ownedProfiles.length === 1) throw new AuthError('An account must keep one profile.', 400);
      await options.onProfileDelete(session.accountId, profileId);
      service.deleteProfile(session.accountId, profileId);
      return { message: 'Profile deleted.' };
    });
    routes.post(`${basePath}/api/profiles/:id/switch`, async (request, reply) => {
      const session = signedIn(request);
      const token = cookieToken(request, cookieName)!;
      const next = service.switchProfile(session.accountId, token, (request.params as { id: string }).id);
      setSessionCookie(reply, cookieName, next, secure);
      return { message: 'Profile switched.' };
    });
    routes.post(`${basePath}/api/account/username`, async (request) => {
      const session = signedIn(request);
      await service.changeLoginUsername(session.accountId, field(request, 'password'), field(request, 'username'));
      return { message: 'Login username changed.' };
    });
    routes.post(`${basePath}/api/account/email`, async (request) => {
      const session = signedIn(request);
      await service.requestEmailChange(session.accountId, field(request, 'password'), field(request, 'email'));
      return { message: 'Check the new address for a confirmation link.' };
    });
    routes.post(`${basePath}/api/account/password`, async (request, reply) => {
      const session = signedIn(request);
      await service.changePassword(session.accountId, field(request, 'oldPassword'), field(request, 'newPassword'));
      clearSessionCookie(reply, cookieName, secure);
      return { message: 'Password changed. Sign in again.' };
    });
  });
};

export default fastifyPlugin(authPlugin, { name: 'site-authenticator' });
