# HRMS deployment contract

The application has two independently deployed surfaces:

1. Vite builds `src/` into static files under `dist/`.
2. The browser calls same-origin `/api/*.php`; the web server maps `/api/` to
   the PHP directory `api/`. Each endpoint loads `api/config/bootstrap.php`,
   which validates configuration, authenticates the request, and connects to
   MongoDB through the PHP extension and Composer library.

Never use the repository root as a public document root. It contains source,
maintenance scripts, local environment files, and possibly ignored backups.

## Runtime requirements

- Node.js 20.19 or newer for build/tooling.
- PHP 8.1 or newer with `ext-mongodb` 2.3 or newer.
- Composer 2 and the packages in `api/composer.lock`.
- MongoDB reachable from the PHP runtime.
- A private writable runtime directory outside both document roots.

## Build and install

```text
npm ci
npm run check
composer --working-dir=api install --no-dev --classmap-authoritative
```

Deploy `dist/` as the static document root. The build copies
`public/.htaccess` into `dist/` for Apache BrowserRouter fallback. Other web
servers need the equivalent fallback to `index.html` for paths that are not
real files, while `/api/` must bypass that fallback.

## Required production configuration

Inject secrets through the process/service manager; checked-out `.env` files
never override already-injected variables.

```text
APP_ENV=production
MONGODB_URI=mongodb+srv://...
MONGODB_DB_NAME=hrms
HRMS_JWT_SECRET_FILE=/var/lib/hrms/private/jwt-secret
HRMS_ALLOWED_ORIGINS=https://hrms.example.com
HRMS_COOKIE_SAMESITE=Lax
HRMS_PRIVATE_DIR=/var/lib/hrms/private
HRMS_LOG_DIR=/var/log/hrms
```

The JWT secret file must be outside the checkout and both document roots,
readable by the PHP service account, and contain a unique random value of at
least 32 characters. `HRMS_JWT_SECRET=<value>` may be injected instead; when
set, it takes precedence over `HRMS_JWT_SECRET_FILE`.

`HRMS_ALLOWED_ORIGINS` is an explicit comma-separated allowlist. Wildcards are
rejected because authentication uses credentialed cookies. Use
`HRMS_COOKIE_SAMESITE=None` only when the frontend and API genuinely need a
cross-site cookie, and only over HTTPS.

Set `HRMS_TRUST_PROXY_HEADERS=true` only when the application is behind a
trusted proxy that removes client-supplied forwarded headers. Otherwise leave
it false.

## Apache routing

Use `deploy/apache-vhost.example.conf` as the routing model. The API's own
`.htaccess` blocks configuration, dependency, dotfile, and maintenance paths.
PHP's development server ignores `.htaccess`, so `npm run dev:php` uses
`scripts/dev-router.php` to apply equivalent restrictions.

## Phase 2 multi-tenant migration runbook

### Preconditions and backup

Use a maintenance window and stop application writes for the full migration,
index, and application cutover. Confirm `MONGODB_URI` and `MONGODB_DB_NAME`
identify the intended database, and choose the permanent lowercase company
slug before starting. This migration is for the existing single-company data
set; its dry run must report no conflicting non-empty `company_id` values.

Take and verify a provider snapshot that can restore both data and indexes.
Also take a protected logical backup outside the checkout if desired:

```text
npm run db:dump -- --privileged-full-database --out=/var/backups/hrms/pre-phase2
```

The logical dump contains documents but not index definitions, so it is not a
substitute for a snapshot or a separately recorded index inventory.

### Migrate and install indexes

Run the read-only preview first and review every collection count. Then run
the confirmed migration with exactly the same company name and slug:

```text
php bin/migrate-add-company-id.php --dry-run --name="Company #1" --slug=company-1
php bin/migrate-add-company-id.php --confirm --name="Company #1" --slug=company-1
php scripts/setup-indexes.php
```

Do not run index setup until the confirmed backfill succeeds. Treat any
`FAIL` line or non-zero exit from index setup as a failed deployment and keep
the application in maintenance mode. After the Phase 2 application is active,
expire old login cookies so users authenticate again with tenant-bearing JWTs.

### Tenant selection for login and CLI maintenance

Clients should always send the selected tenant slug when logging in:

```json
{"company_slug":"company-1","email":"user@example.com","password":"..."}
```

`company_slug` may be omitted only while exactly one active company exists.
With multiple active companies it is required; an unknown or inactive slug is
rejected without revealing whether an account exists.

Operationally, always pass an explicit company slug or ObjectId to
tenant-specific maintenance commands rather than relying on an ambient
default. For example:

```text
php scripts/migrate_mongodb.php --company=company-1
php scripts/seed-departments-teams.php --company=company-1
php scripts/clear-broken-images.php --company=company-1
php scripts/migrate-images-to-db.php --company=company-1
```

The scheduled attendance-maintenance command is the deliberate exception: it
enumerates every active company and remains a platform-wide scheduled task.

### Rollback caution

Do not attempt rollback by deleting `company_id`, restoring only selected
collections, or reverting application code while leaving migrated indexes in
place. Index setup replaces legacy global unique indexes with tenant-scoped
ones. If rollback is necessary, keep writes stopped and restore the database
snapshot and matching pre-Phase 2 application release as one coordinated
operation. The repository restore tool replaces all tenant and global data,
requires `--confirm=<database-name>` and `--privileged-full-database`, and may
also require the explicitly acknowledged non-transactional mode described
below.

## First deployment and maintenance

Run indexes from the command line only:

```text
php scripts/setup-indexes.php
```

Schedule attendance maintenance outside HTTP request handling. The command is
idempotent for already-processed sessions and exits non-zero on failure:

```text
npm run attendance:maintain
```

For example, run it every 10 minutes from cron/systemd timer/Task Scheduler so
the 21:30 Asia/Kolkata cutoff and missed-attendance pass do not depend on a user
opening the dashboard. Send stdout/stderr to the private application log path
and alert on a non-zero exit status.

Database dumps and restores read credentials from `MONGODB_URI` and never echo
the URI. Restores require `--confirm=<database-name>`. Standalone MongoDB does
not support transactions, so non-transactional replacement additionally
requires `--allow-non-transactional` after a verified backup.

Do not deploy `latest-backup/`, `prod-backup/`, `composer.phar`, `mongodb_ext/`,
or any `.env*` file into either document root.
