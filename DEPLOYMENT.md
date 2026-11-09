# Running and deploying Migs Geo

The infrastructure is one Node.js process and one SQLite database. There is no separate database server, Redis, background worker, or cloud account to configure.

## Run with Docker Compose

```sh
docker compose up --build -d --wait
```

Open `http://127.0.0.1:4387`. If the Node version of the app is running already, stop it first so the port is available. Set `TZ=Europe/Berlin` (or your preferred timezone) when starting Compose to make daily limits reset at local 4am:

```sh
TZ=Europe/Berlin docker compose up --build -d --wait
docker compose logs -f geo
docker compose down
```

`docker compose down` leaves the named `geography` volume intact. It contains `/data/geography.sqlite`, SQLite's WAL files, and `/data/backups/`. Avoid `docker compose down --volumes` unless you intentionally want to erase that collection.

The image builds the frontend in a separate stage, installs production dependencies, runs as the unprivileged `node` user, and checks the API and SQLite every ten seconds. Compose publishes the app on this computer's loopback interface. No secrets or personal data enter the image; `.dockerignore` permits only the necessary source and public seed data.

## SQLite startup and upgrades

On first startup the app creates its writable directory, applies numbered SQL migrations in a transaction, initializes settings, and seeds the public collection once. Startup completes before the health endpoint is available. On later launches, it preserves all cards and review history. A `meta` record prevents deleted/imported collections from being silently seeded again.

Schema versions are recorded in SQLite's `PRAGMA user_version`. Add a numbered file under `server/migrations/` and register it in `server/migrations.mjs` for a future change. Migrations roll back on failure. Opening a database newer than the running app fails explicitly. An existing database is snapshotted before schema changes, at the first launch each day, and before JSON restore.

The initial migration also adopts databases created by the first unversioned release without dropping tables. Use one application instance per SQLite volume. Keep the volume on persistent local block storage; SQLite WAL is not intended for a shared network filesystem or replicas writing independently.

## Back up or move the collection

Use Settings → Export backup or `GET /api/backup`. Restore with Settings → Restore backup or `POST /api/restore`, using that JSON file as the body. Restoring replaces the collection atomically and first preserves a snapshot of the existing database.

To move from the local Node app to a container, export the current collection, start Compose, and restore the export. Do not copy only a live `.sqlite` file while ignoring its WAL; use the built-in export/snapshot or stop the app before copying the entire data directory. Keep an additional backup outside the container host.

## Runtime settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4387` | HTTP listen port |
| `GEO_HOST` | `127.0.0.1` | Bind address; image sets `0.0.0.0` inside the container |
| `GEO_DATA_DIR` | `data/local` | Writable SQLite and backup directory; image sets `/data` |
| `TZ` | Host timezone; image uses `UTC` | Local timezone for the 04:00 study-day boundary |
| `GEO_ORIGIN` | Unset | One exact additional HTTP(S) origin accepted behind a reverse proxy |

The app is currently a single-user service without login. For internet hosting, put it behind an authenticated HTTPS reverse proxy, set `GEO_ORIGIN=https://your-domain.example`, preserve the incoming Host header, and attach a persistent disk at `/data`. The default Compose setup remains local. No public deployment or registry publishing is performed by this repository's CI.

## Continuous integration

[GitHub Actions](https://github.com/michaelhball/migs-geo/actions) runs for every push to `main`, every pull request, and manual dispatch:

1. On Node.js 24 and 26: clean install, scheduler/collection/HTTP API/migration tests, TypeScript checking, and production build.
2. Build the actual production Docker image and validate Compose.
3. Start the image with a new disposable SQLite volume and wait for its health check.
4. Verify the served frontend, map data, database schema, seed collection, and non-root user.
5. Create a place, change settings, and record a review through HTTP.
6. Restart the container and verify those values and FSRS memory persisted.
7. Exercise backup/restore and check SQLite integrity and foreign keys.

The container test never mounts real user data or binds a host port. It removes only its own uniquely named container and test volume. The frontend build is kept as a short-lived workflow artifact. Run the same smoke check locally, with Docker running:

```sh
docker build -t migs-geo:ci .
node scripts/container-smoke.mjs migs-geo:ci
```
