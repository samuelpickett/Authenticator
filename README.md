# Site Authenticator

Site Authenticator is a self-hosted TypeScript module that adds registration, sign-in, account settings, and user-created profiles to a Fastify website. Each site installs its own copy with a separate SQLite database. One account has an email and login username, and its owner can create and switch between multiple public profiles. The module includes ready-made pages whose CSS a site administrator can customize.

## Instructions for Build and Use

Steps to build and/or run the software:

1. Install Node.js 22 or newer and npm. From this project directory, run `npm install`.
2. Copy the example settings with `Copy-Item .env.example .env` in PowerShell. The defaults run locally; set the SMTP values in `.env` to send real email.
3. Run `npm run dev`, then open `http://localhost:3000/auth/register`. This command builds the TypeScript and starts the example server. Use `npm test` to build and run the integration tests.

Instructions for using the software:

1. Register with a login username, email, password, and first profile name. Passwords must contain at least 15 Unicode code points. Usernames are case-insensitive and limited to 32 visible Unicode characters.
2. Open the verification link sent by email and select **Confirm**. If SMTP is not configured in local development, find the link in the server terminal. Sign in to reach the configured confirmation destination, `/auth/profile` by default.
3. On the profile page, create, rename, delete, or switch profiles. Change your login username, email, or password from its separate account-settings form. Enter your current password only for the change you submit. Email changes require confirmation at the new address.

### Site configuration

The example server loads `.env` if present. A site administrator sets these values for the installation; individual account holders do not configure an email server.

| Setting | Purpose |
| --- | --- |
| `AUTH_DATABASE_PATH` | SQLite database location; default `./data/auth.sqlite`. |
| `AUTH_PUBLIC_URL` | Public site origin used in email links and same-origin checks; default `http://localhost:3000`. |
| `AUTH_SECURE_COOKIES` | Use `false` only for local HTTP development. Production requires HTTPS. |
| `AUTH_SMTP_HOST`, `AUTH_SMTP_PORT`, `AUTH_SMTP_SECURE` | The site's SMTP relay. Port 587 with `false` requires STARTTLS; port 465 commonly uses `true` for implicit TLS. |
| `AUTH_SMTP_USER`, `AUTH_SMTP_PASSWORD`, `AUTH_EMAIL_FROM` | SMTP credentials and sender address. Production mode requires a host and sender. |
| `AUTH_CONFIRMATION_REDIRECT_PATH` | Same-origin page reached after email confirmation and, if needed, sign-in; default `/auth/profile`. Queries and fragments are not accepted. |
| `AUTH_CUSTOM_CSS_FILE` | Local stylesheet that the example server serves at `/auth/site.css`. |
| `AUTH_CUSTOM_CSS_URL` | Same-origin stylesheet path provided by a host website. The CSS file takes precedence in the example server. |

The built-in CSS defines `--auth-bg`, `--auth-surface`, `--auth-ink`, `--auth-accent`, `--auth-border`, and `--auth-muted`. A custom stylesheet loads after the default one; for example, `:root { --auth-accent: #6b3ea8; }` changes the accent color.

### Add the module to another Fastify site

Build this project with `npm run build`, then install it locally in the other Node.js website (for example, `npm install ../Authenticator`). Register the plugin before routes that need authentication:

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

The host site must use `request.authSession.activeProfileId` when accessing profile-specific data. To enable profile deletion, provide an `onProfileDelete(accountId, profileId)` callback that removes the host site's associated data. Without it, the built-in page hides Delete and the API returns 501. The example server supplies an empty callback because it has no profile-specific site content.

Run `npm run backup` to copy a live SQLite database. Startup and `npm run migrate` apply versioned migrations; when an existing database needs a migration, they create a backup first. Follow the [backup and restore instructions](docs/backups.md) before upgrades. A production site also needs HTTPS, working SMTP delivery, and correctly configured trusted proxy addresses if it uses forwarded client IPs for rate limits. Do not commit `.env`.

## Development Environment

To recreate the development environment, you need the following software and/or libraries with the specified versions:

* Node.js 24.11.0 and npm 11.6.2 were used locally; the package requires Node.js 22 or newer.
* TypeScript 5.9.3 and Fastify 5.12.8 provide the language and web framework.
* better-sqlite3 13.1.1 stores accounts and profiles; Argon2 0.45.2 hashes passwords; Nodemailer 10.5.0 sends email. The exact dependency versions are pinned in `package.json` and `package-lock.json`.

## Useful Websites to Learn More

I found these websites useful in developing this software:

* [Node.js introduction](https://nodejs.org/learn/getting-started/introduction-to-nodejs)
* [Fastify TypeScript documentation](https://fastify.dev/docs/latest/Reference/TypeScript/)
* [SQLite documentation](https://www.sqlite.org/docs.html)
* [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)

## Future Work

The following items I plan to fix, improve, and/or add to this project in the future:

* [ ] Alternate ways of logging in and signing up, such as through Google or Microsoft
* [ ] Multi-factor Authentication
* [ ] An adater for PostgreSQL
