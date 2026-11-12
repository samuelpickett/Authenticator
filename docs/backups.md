# SQLite backup and restore

The authentication database contains account and profile data. The steps below apply to one self-hosted installation. Back up each site's database separately and keep backup files outside publicly served directories.

## Create a backup

From the project directory, with `.env` pointing at the intended database:

```powershell
npm run backup
```

The command uses SQLite's online backup operation, so the site can continue to serve requests. It prints the destination under `./backups`. To choose a destination, run `npm run backup -- C:\safe-location\auth-2026-11-12.sqlite`. The destination must not already exist. Copy completed backups to another machine or storage location with restricted access.

Before a schema upgrade, run a manual backup and record the application version. `npm run migrate` also creates a backup automatically when the database already exists. Starting a newer version with pending migrations creates a backup under the database directory's `backups` subdirectory before changing the schema.

## Check a backup

Keep a separate test copy and open it with SQLite. Run `PRAGMA integrity_check;` and confirm it reports `ok`. Then start a test instance against the copy and verify that a test account can sign in and select its profiles. A backup has not been verified until a restore has been tried.

## Restore

1. Stop the website and any other process using this SQLite database.
2. Move the existing database file **and any matching `-wal` and `-shm` files** into a dated recovery directory. Keep them until the restored site is verified.
3. Copy the chosen backup file to the configured `AUTH_DATABASE_PATH`.
4. Run `npm run migrate` if the backup was made with an older application version. This first makes another backup of the restored file.
5. Start the website. Check registration, sign-in, and profile switching with a test account before reopening traffic.

Do not overwrite a live SQLite database file or copy just its main file while writes are ongoing. If a restore fails, stop the site again and return the preserved database and journal files as a set.
