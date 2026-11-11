# Migs Geo

[![Checks](https://github.com/michaelhball/migs-geo/actions/workflows/ci.yml/badge.svg)](https://github.com/michaelhball/migs-geo/actions/workflows/ci.yml)

A local geography study app with an interactive, offline world map and spaced repetition. Pan, zoom, and click to answer. No account, cloud service, or Anki installation is needed.

## Run

Requires Node.js 24 or newer.

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:4387**. For development, use `npm run dev`. All map assets and dependencies are local after installation. There are no remote map tiles, fonts, tracking scripts, or runtime API calls to external services.

On macOS, double-click **Start Migs Geo.command** after installing dependencies. Keep that terminal window open while studying. `Ctrl+C` stops the server. `PORT` changes the local port; `GEO_DATA_DIR` changes the database location.

Docker is also supported: `docker compose up --build -d --wait`. See [DEPLOYMENT.md](DEPLOYMENT.md) for persistent SQLite storage, schema migrations, backups, and the tested hosting setup.

## Features

- 319 places from Ultimate Geography, with 638 independent cards: place → map and map → place.
- Countries, territories/islands, bodies of water, and broader regions/continents enabled by default. No flags or capitals.
- FSRS-6 scheduling: up to 15 new cards first each day, then due learning and reviews. Both groups are shuffled with a mix of question directions. Each direction has its own schedule, with recall ratings and undo.
- Up to 200 old cards reviewed per day by default, adjustable in Settings. Short learning and relearning repeats do not count toward this limit; deferred reviews keep their due dates.
- Study days run from 4am to 4am in the computer's local timezone. Late-night sessions count toward the previous day; day-based rating intervals are shown as whole days.
- When the regular queue is empty, short learning steps return immediately so you can finish the session without waiting for a timer.
- Checked answers are green when correct, red when incorrect or revealed, and neutral for self-graded locations. Checking an answer leaves the map and your selection in place.
- Map → place questions start with surrounding countries and water in view. Use “Show highlighted place” for a closer look.
- Trackpad scrolling and pinch gestures zoom continuously around the pointer.
- The background map uses cached levels of detail for faster rendering; question outlines and answer checking retain their original geometry.
- All study sessions in the interface save progress. Unscheduled practice controls are hidden.
- Search, edit, add, pause, and resume places. Exact polygon editing is available through the API; the UI can add self-graded point locations.
- SQLite persistence, automatic daily startup snapshots, JSON export, and atomic restore.
- Persistent study logs preserve first answers, later checks, reveals, timings, ratings, and the context of each attempt. Logs stay in the private local database and are included in backups.
- Statistics show first-try recall by actual elapsed interval, daily activity, patterns by direction and geography, difficult cards, and individual review history. Earlier reviews retain their ratings without guessing missing first answers.
- A complete local JSON API, OpenAPI discovery, and CLI. See [API.md](API.md).

This is a separate app, not an Anki client. It imports public place names and notes into its own data model and starts a fresh schedule. Anki review history and scheduling formats are not used, and the original Anki collection is never modified.

## Programmatic use

```sh
node scripts/geo.mjs GET /api/stats
node scripts/geo.mjs GET /api/places/france
node scripts/geo.mjs PATCH /api/settings '{"newPerDay":20}'
node scripts/geo.mjs POST /api/places @new-place.json
```

The UI uses the same endpoints. An agent can manage the full collection, settings, cards, reviews, and backups without browser automation. The machine-readable reference is `GET /api/docs`.

## Data and backups

Personal data is in `data/local/geography.sqlite`, ignored by Git. Backups are under `data/local/backups/`; one SQLite snapshot is created at the first launch each day and before restoring a JSON export. Export a portable backup from Settings or `GET /api/backup`. Keep exports outside the repository or in an ignored `backups/` directory.

Bundled public data:

- `data/notes.json`: public place names, notes, and tags from Ultimate Geography, with independent IDs.
- `data/places.json`: place metadata and prepared map geometry; used only to initialize a new database.
- `public/data/world.json`: simplified offline world map.

The application uses a canvas map renderer and caches place data in memory. SQLite indexes and transactions handle review state. The checked-in data fits regular Git; Git LFS is unnecessary.

## Map limitations

Natural Earth is a generalized 1:10m atlas. Coastlines and borders are not survey-level data. Its disputed-boundary conventions may differ from other atlases. Two places use approximate, self-graded markers: Celtic Sea and Bering Strait. Oceania uses a generalized study extent covering Australia, New Zealand, Melanesia, Micronesia, Polynesia, and the water between them. This is a study boundary, not an official border. The Balkan Peninsula uses Natural Earth's regional outline, covering the peninsula across country borders; both “Balkan Peninsula” and “Balkans” are accepted names. Small places allow a 3 km near-boundary tolerance. Larger regions and oceans may overlap smaller features by design. Correctness feedback is a study aid; your recall rating controls the schedule.

To regenerate map assets, first download the public source geometry:

```sh
python3 scripts/download-geography.py
python3 scripts/prepare-geography.py
```

Raw source downloads are ignored by Git. The generated atlas is included so a clone can run without downloading map sources.

## Checks

```sh
npm test
npx tsc --noEmit
npm run build
```

Tests cover scheduling, daily limits, practice isolation, stale/duplicate submissions, undo, import rollback, persistence, map matching, collection editing, and SQLite migrations. Tests use temporary databases, never personal study data. GitHub Actions also builds and starts the production Docker image and verifies database persistence across a restart. See [deployment checks](DEPLOYMENT.md#continuous-integration).

## Sources and licenses

Code: MIT. Ultimate Geography's non-image content is public domain ([license](data/sources/ULTIMATE-GEOGRAPHY-LICENSE.md)); no original deck images are used. Natural Earth map data is [public domain](https://www.naturalearthdata.com/about/terms-of-use/). [Leaflet](https://leafletjs.com/) is BSD-2-Clause; [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) is MIT.
