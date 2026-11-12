# Site Authenticator

A self-hosted TypeScript authentication module for independent websites. Each installation has its own accounts and SQLite database. One account signs in with a login username and can create several separately named public profiles.

## Current scope

- Register with a login username, email, password, and first profile name.
- Verify email, sign in and out, reset a password, and change the login username, email, or password.
- Create, rename, delete, and switch between profiles without another login.
- Use ready-made pages under `/auth`; add a same-origin stylesheet to change their appearance.
- Read `request.authSession` in later Fastify routes to identify the account and active profile.

Usernames are case-insensitive for uniqueness and limited to 32 visible Unicode grapheme clusters. Control characters, misleading invisible formatting, and leading or trailing whitespace are rejected. Email is an account property, shared by all its profiles. Email login, MFA, social login, and PostgreSQL are outside this first version.

The module compares the whole email address without regard to letter case and does not apply provider-specific rewrites such as removing dots. Profile public usernames are unique within one installation; login usernames have their own uniqueness scope.

## Run the example host

Node.js 22 or newer is required. The example uses Node.js 24.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Open `http://localhost:3000/auth/register`. With no SMTP configuration and outside production mode, verification and reset emails are printed to the terminal. Open the link printed there. The example host also exposes `/example-private` to show how an authenticated route gets the current account and profile IDs.

After selecting **Confirm** on a verification or email-change page, the user is sent to the administrator's confirmation destination. The example destination is `/auth/profile`. A signed-out user signs in first and then reaches that page. Opening the email link alone does not change account state or sign the user in.

`npm run build` compiles the TypeScript; `npm test` builds and runs the integration tests. `npm start` runs an existing build.

## Use in another Fastify website

Build this repository with `npm run build`, then install it as a local package in another Node.js website (for example, `npm install ../Authenticator`). Register it before routes that read the session:

```ts
import fastify from 'fastify';
import { authPlugin, smtpSender } from 'site-authenticator';

const app = fastify();
await app.register(authPlugin, {
  databasePath: './data/auth.sqlite',
  publicUrl: 'https://my-site.example',
  confirmationRedirectPath: '/members/profile',
  mailer: smtpSender({
    host: process.env.SMTP_HOST!,
    port: 587,
    secure: false,
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: 'accounts@my-site.example',
  }),
});

app.get('/my-posts', async (request, reply) => {
  if (!request.authSession) return reply.code(401).send({ message: 'Sign in.' });
  return { profileId: request.authSession.activeProfileId };
});
```

The host must use `activeProfileId`, not a profile ID supplied by the browser, when it reads or changes profile-specific data. Every profile belongs to exactly one account. To enable deletion, pass an `onProfileDelete(accountId, profileId)` callback that removes that profile's content from the host site. Without it, the built-in page hides Delete and the API returns 501. The callback runs before the authentication record is deleted. It should fail safely and be idempotent because host data and the authentication database may be separate. The example host passes a no-op callback because it stores no profile-specific content.

The package currently targets Fastify on Node.js. A different server framework needs an adapter. The SQLite access is isolated in the module so a PostgreSQL implementation can be added later; PostgreSQL is not yet supported.

## Configuration

The example host loads `.env` if present. Library consumers pass equivalent values to `authPlugin`.

| Setting | Meaning |
| --- | --- |
| `AUTH_DATABASE_PATH` | Writable path to this site's SQLite database; default `./data/auth.sqlite`. |
| `AUTH_PUBLIC_URL` | Public origin used in email links and same-origin checks; default `http://localhost:3000`. |
| `AUTH_SECURE_COOKIES` | Set `true` behind HTTPS. The example permits `false` for local HTTP development. Library installations default to secure cookies. |
| `AUTH_SMTP_HOST`, `AUTH_SMTP_PORT`, `AUTH_SMTP_SECURE` | This site's SMTP relay. Port 587 with `false` requires STARTTLS; port 465 commonly uses `true` for implicit TLS. |
| `AUTH_SMTP_USER`, `AUTH_SMTP_PASSWORD`, `AUTH_EMAIL_FROM` | SMTP credentials and sender address. Production mode requires SMTP host and sender. |
| `AUTH_CUSTOM_CSS_FILE` | Example host only: local CSS file served at `/auth/site.css`. |
| `AUTH_CUSTOM_CSS_URL` | Same-origin path to a stylesheet served by the host site. The local CSS file takes precedence. |
| `AUTH_CONFIRMATION_REDIRECT_PATH` | Page to reach after email verification or email-change confirmation and, if needed, sign-in. Default `/auth/profile`; must be a same-origin absolute path without a query or fragment. |

The site administrator configures SMTP for the installation; individual account holders do not configure mail servers. Do not commit `.env`. For a deployed site, use HTTPS and a trusted reverse proxy; configure Fastify's trusted proxy addresses if it needs forwarded client IPs for rate limits. Do not blindly trust every forwarded address.

The default stylesheet exposes `--auth-bg`, `--auth-surface`, `--auth-ink`, `--auth-accent`, `--auth-border`, and `--auth-muted`. For example, a site's CSS can include `:root { --auth-accent: #6b3ea8; }`. It loads after the built-in stylesheet. The CSS URL must begin with one `/` and stay on the same origin.

For the example host, set `AUTH_CUSTOM_CSS_FILE` to a CSS file path and the server will serve it at `/auth/site.css`. An integrating site can serve its own CSS path and pass that path as `customCssUrl`.

## Database changes and backups

The current migration is versioned in the database module and recorded in `schema_migrations`. Startup and `npm run migrate` apply pending migrations. When an existing database needs migration, both paths first write a live backup: the CLI writes to `./backups`, and startup writes beside the database in a `backups` directory. Startup stops if that backup fails. See [backup and restore instructions](docs/backups.md) before deployment or upgrades.

## Security behavior and limits

Passwords use Argon2id and must contain at least 15 Unicode code points. Random session and action tokens are stored only as hashes. Sessions expire after 30 minutes idle or eight hours total; logout and password changes revoke them. Email verification, password reset, and email changes use expiring one-use links. Login, registration, and email-request routes have persistent rate limits. Built-in JSON forms require a matching `Origin` header and do not enable cross-origin access.

Changing the login username, email, or password requires the current password again. These are separate forms: the user fills in only the password field for the change being submitted. Email-change confirmation and password changes end existing sessions.

This is an initial implementation. Before exposing a site publicly, review the host's authorization rules, SMTP delivery, trusted proxy configuration, backup restores, and the full account recovery and abuse policy for that site. The module does not delete host-owned posts or other profile content on its own.
