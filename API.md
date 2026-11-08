# Migs Geo API

The UI, CLI, and agents use the same API at `http://127.0.0.1:4387/api`. It binds to loopback by default; there is no cloud service, Anki dependency, or browser requirement. `GET /api/docs` returns the machine-readable OpenAPI contract. Requests that change data use `Content-Type: application/json`. Errors return a non-2xx status and `{ "error": "…" }`. Docker and future hosting configuration are described in [DEPLOYMENT.md](DEPLOYMENT.md).

## CLI

```sh
node scripts/geo.mjs GET /api/stats
node scripts/geo.mjs GET /api/places
node scripts/geo.mjs GET /api/places/france
node scripts/geo.mjs PATCH /api/settings '{"newPerDay":20}'
node scripts/geo.mjs PATCH /api/cards/france:locate '{"suspended":true}'
node scripts/geo.mjs POST /api/places @new-place.json
node scripts/geo.mjs GET /api/backup > backup.json
```

Set `GEO_URL` for another local port. IDs are stable slugs in the bundled collection; custom places receive UUIDs unless you supply an ID. Never infer an ID from a display name—query the collection first.

## Collection and cards

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/health` | Readiness, app version, SQLite query status, and schema version |
| GET | `/api/places` | Active places without geometry; `?geometry=true` includes shapes; `?archived=true` also includes archived places |
| GET | `/api/places/:id` | Complete place, including geometry |
| POST | `/api/places` | Create a place and both question cards |
| PATCH | `/api/places/:id` | Update name, notes, aliases, geometry, classification, region, center, or archived status |
| DELETE | `/api/places/:id` | Archive, preserving cards and history; restore with `PATCH {"archived":false}` |
| GET | `/api/cards` | Full scheduling state; optional `?placeId=france` |
| GET | `/api/cards/:id` | One card and FSRS memory state |
| PATCH | `/api/cards/:id` | Pause/resume (`suspended`), change review date (`due`, ISO timestamp), or return a card to new (`reset:true`); history is retained |
| GET / PATCH | `/api/settings` | Read or update study settings |

Create a location with an approximate marker:

```json
{
  "id": "lake-baikal",
  "name": "Lake Baikal",
  "kind": "water",
  "region": "Asia",
  "info": "A lake in southern Siberia.",
  "aliases": ["Baikal"],
  "geometry": { "type": "Point", "coordinates": [108, 53.5] }
}
```

Use a GeoJSON `Polygon` or `MultiPolygon` for automatic map checking. Coordinates are **[longitude, latitude]**, rings must be closed, and longitude/latitude must be within ±180/±90. Point locations are self-graded. `center` is a `[longitude, latitude]` location for future framing uses; geometry is used to frame the current map. `small:true` allows a 3 km near-boundary tolerance. Polygon boundaries are atlas approximations, not survey data.

Kinds: `country`, `territory`, `water`, `region`. `region` is any string used by study filters. Display notes are plain text; imported HTML is displayed without markup. Names/aliases are compared without case, accents, punctuation, or an initial “the”.

Creating/editing a place never resets its cards. Changes increment card versions so an older question cannot overwrite a newer edit. The two card IDs are `<place-id>:locate` and `<place-id>:identify`.

## Study lifecycle

1. `POST /api/study/next {}` gets an eligible card and an opaque `token`. It does not change progress. `{"practice":true}` creates an unscheduled practice question; optional `placeId` and `mode` select a practice card.
2. `POST /api/study/check` with the token and an answer returns correctness, the answer geometry, and the four upcoming intervals. This does not change progress.
3. `POST /api/study/rate` with token and integer `rating` saves the review atomically. Ratings: **1 Again, 2 Hard, 3 Good, 4 Easy**. The user's rating, not the automatic map result, drives scheduling.

```sh
node scripts/geo.mjs POST /api/study/next '{}'
# Use the token returned above:
node scripts/geo.mjs POST /api/study/check '{"token":"TOKEN","answer":{"point":[2.35,48.85]}}'
node scripts/geo.mjs POST /api/study/rate '{"token":"TOKEN","rating":3}'
```

For a naming question, use `"answer":{"text":"France"}`. To reveal, use `"answer":{"reveal":true}`. Approximate map markers return `correct:null`. Duplicate rating requests using the same token return the original result without another review. A stale card version rejects the rating. Tokens are ephemeral and expire on server restart. Ask for a fresh question after a restart.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/queue` | Current counts, next card ID, next learning time |
| GET | `/api/stats` | Counts, daily review history, recall ratings |
| GET | `/api/reviews` | Review history, including undone records |
| POST | `/api/reviews/undo` | Undo the last active review; preserve an audit record |
| GET | `/api/backup` | Full versioned JSON export, including places, cards, settings, and review history |
| POST | `/api/restore` | Restore that export atomically; server first saves a SQLite snapshot of existing data |

## Scheduling

FSRS-6, through the pinned `ts-fsrs` dependency. Default target retention: 90%; learning: 1 minute / 10 minutes; relearning: 10 minutes. New limit: 15 cards per local calendar day. Both new and due cards are shuffled independently of place names; the daily order is stable across queue reads and restarts. When both directions are available in the current group, the next card switches direction after two consecutive reviews in the same direction. This respects the enabled modes and sibling separation.

Due learning and review cards are mixed in a shuffled queue, with a new card after every three reviews when both groups have cards. Review cards due at any time today are eligible; learning cards become eligible at their exact due time. No daily review cap. By default, the reverse of a place studied today waits until tomorrow. Both directions keep separate scheduling state. The daily counter uses the server computer's local timezone and resets at midnight.

Practice, browsing, checks, and answer reveals do not change the schedule. Only a rating on a scheduled question does. Review dates and memory states persist across restarts. Suspended cards and archived places are excluded from scheduled study. Practice can intentionally include paused cards.

## Direct data access

Runtime data: `data/local/geography.sqlite` (override with `GEO_DATA_DIR`). Tables: `places`, `cards`, `reviews`, `settings`, and `meta`. Foreign keys, WAL, and transactions protect saves. Scheduling memory is versioned JSON inside SQLite. The public `data/places.json` is an initial seed, loaded once, not the live database. Exported backups use `format:"migs-geo", version:1`.

Prefer the API while the server is running. For direct SQLite edits, stop the server first, keep a backup, preserve `memory`, `due`, `state`, `reps`, and `version` consistency, then restart. Place data is cached in memory for fast reads. Never commit `data/local`, user exports, or review history. The server is intended for a trusted local machine, not exposure to a LAN or the public internet.
