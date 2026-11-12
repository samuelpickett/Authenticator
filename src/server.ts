// This file contains AI-generated code.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import fastify from 'fastify';
import authPlugin from './plugin.js';
import { smtpSender, type MailSender } from './mailer.js';

/** Selects SMTP for deployment and visible test links for local development. */
function configuredMailer(): MailSender {
  const host = process.env.AUTH_SMTP_HOST;
  const from = process.env.AUTH_EMAIL_FROM;
  if (host && from) {
    return smtpSender({
      host,
      port: Number(process.env.AUTH_SMTP_PORT ?? 587),
      secure: process.env.AUTH_SMTP_SECURE === 'true',
      user: process.env.AUTH_SMTP_USER || undefined,
      password: process.env.AUTH_SMTP_PASSWORD || undefined,
      from,
    });
  }
  if (process.env.NODE_ENV === 'production') throw new Error('SMTP settings are required in production');
  return {
    /** Prints development-only links without sending real email. */
    async send(to, subject, body) {
      process.stdout.write(`[development email] To: ${to}\nSubject: ${subject}\n${body}\n`);
    },
  };
}

/** Starts a small example host with a protected route for integration testing. */
async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const app = fastify({ logger: true, bodyLimit: 16 * 1024 });
  const publicUrl = process.env.AUTH_PUBLIC_URL ?? 'http://localhost:3000';
  const secureCookies = process.env.NODE_ENV === 'production'
    ? true
    : process.env.AUTH_SECURE_COOKIES !== 'false' && !publicUrl.startsWith('http://localhost');
  const customCssFile = process.env.AUTH_CUSTOM_CSS_FILE;
  if (customCssFile) {
    app.get('/auth/site.css', async (_request, reply) => reply.type('text/css').send(await readFile(resolve(customCssFile), 'utf8')));
  }
  await app.register(authPlugin, {
    databasePath: resolve(process.env.AUTH_DATABASE_PATH ?? './data/auth.sqlite'),
    publicUrl,
    mailer: configuredMailer(),
    secureCookies,
    customCssUrl: customCssFile ? '/auth/site.css' : process.env.AUTH_CUSTOM_CSS_URL || undefined,
    confirmationRedirectPath: process.env.AUTH_CONFIRMATION_REDIRECT_PATH || '/auth/profile',
    /** The example host has no profile-specific content to remove. */
    onProfileDelete: async () => {},
  });
  app.get('/', async (_request, reply) => reply.redirect('/auth/login'));
  app.get('/example-private', async (request, reply) => {
    if (!request.authSession) return reply.code(401).send({ message: 'Sign in to continue.' });
    return { accountId: request.authSession.accountId, activeProfileId: request.authSession.activeProfileId };
  });
  await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 3000) });
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
