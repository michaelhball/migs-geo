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

Kinds: `country`, `territory`, `water`, `region`; all four are enabled by default. The `region` kind covers broader places such as continents and Scandinavia. The separate `region` field is any string used by the “Parts of the world” study filter; an empty `settings.regions` array includes the whole world. Display notes are plain text; imported HTML is displayed without markup. Names/aliases are compared without case, accents, punctuation, or an initial “the”.

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
| GET | `/api/queue` | Current counts, next card ID, next learning time, `studyDay`, `nextDayAt`, and server-local `timeZone` |
| GET | `/api/stats` | Counts, daily review history, recall ratings |
| GET | `/api/analytics` | First-try recall, actual interval buckets, daily activity, difficult cards, classifications, and wrong-answer patterns; optional `from`, `to` (inclusive YYYY-MM-DD study dates) and `cardId`. A `cardId` filter also returns chronological `history` with ratings, first answers, and actual/planned intervals, including legacy reviews with unknown first answers. |
| GET | `/api/reviews` | Review history, including undone records |
| POST | `/api/reviews/undo` | Undo the last active review; preserve an audit record |
| GET | `/api/study/log` | Persistent attempts and ordered answer checks; `cardId`, `limit` (1–500), `offset`, and `includePractice=true` filters |
| GET | `/api/backup` | Full versioned JSON export, including places, cards, settings, review history, and the study log |
| POST | `/api/restore` | Restore that export atomically; server first saves a SQLite snapshot of existing data |

## Scheduling

FSRS-6, through the pinned `ts-fsrs` dependency. Default target retention: 90%; learning: 1 minute / 10 minutes; relearning: 10 minutes. New limit: 15 cards per study day, from 04:00 to the following 04:00 in the server computer's local timezone. Available new cards take priority until that daily allowance is used, including after a refresh or restart. Both new and due cards are shuffled independently of place names; the daily order is stable across queue reads and restarts. When both directions are available in the current group, the next card switches direction after two consecutive reviews in the same direction. This respects the enabled modes and sibling separation.

After new cards, due learning and review cards are mixed in a shuffled queue. Review cards due before the next 04:00 boundary are eligible, excluding cards already reviewed in the current study day. When those queues are empty, learning and relearning cards due within the next 10 minutes can be studied immediately. These early repeats are shuffled after each rating and avoid repeating the same place back-to-back when another is available. `counts.learning` includes these available short-step cards. Queue reads do not change due dates; FSRS uses the actual rating time. Long-term reviews and learning cards scheduled more than 10 minutes ahead remain scheduled. No daily review cap. By default, the reverse of a place studied today waits until tomorrow. Both directions keep separate scheduling state. New-card allowances, sibling burial, shuffling, daily history, and analytics all roll over at local 04:00, including daylight-saving changes. A review at 01:00 belongs to the previous study date. New day-based schedules use the target study day's 04:00 start; existing due timestamps are preserved and interpreted within the same day window. Historical review dates are regrouped on migration and restore; exact timestamps, ratings, and scheduling memory are retained.

Browsing, checks, and answer reveals do not change the schedule. Only a rating on a scheduled question does. Review dates and memory states persist across restarts. Suspended cards and archived places are excluded from scheduled study. Unscheduled practice is not exposed in the interface; explicit API practice requests remain available for testing and can intentionally include paused cards without changing progress.

Interval previews return `days` as a whole number for day-based reviews and `null` for short learning steps. `seconds` is the actual time until the returned `due` timestamp, which can be less than 24 hours for a one-day interval. Use `days` for the rating-button label. Long intervals remain whole days rather than approximate months or years.

## Direct data access

Analytics include active scheduled ratings only. They exclude undone reviews, unscheduled practice, and unrated attempts. `summary.firstAccuracy` uses the first recorded check; reveals count as unsuccessful, while self-graded results and missing legacy first checks are excluded. `ratedRecall` is the separate percentage of self-ratings above Again. Every group includes sample counts and unknown coverage. An interval measures actual elapsed time from the previous rating to the first check, or to the rating for legacy reviews; it is not the planned delay. New introductions are reported separately from return attempts. Classification uses the original snapshot where available and current place metadata for older reviews. Raw answers and uncompleted attempts remain accessible through `/api/study/log`.

Each question and valid answer check is logged even if it is never rated. The log preserves raw typed answers or map coordinates, reveals, correctness, time since the question was shown (including pauses), the original place classification, card memory, and study settings. The first check remains identifiable after subsequent checks. Ratings link atomically to reviews; undo retains the log with `undone:true`. Re-rating the same token is idempotent, and checks after rating are rejected. Explicit API practice is logged separately and excluded by default. Older reviews have no invented first-answer records.

Runtime data: `data/local/geography.sqlite` (override with `GEO_DATA_DIR`). Tables: `places`, `cards`, `reviews`, `study_attempts`, `study_checks`, `settings`, and `meta`. Foreign keys, WAL, and transactions protect saves. Scheduling memory is versioned JSON inside SQLite. The public `data/places.json` is an initial seed, loaded once, not the live database. Exported backups use `format:"migs-geo", version:2` and include a `studyLog` object with raw `attempts` and `checks` rows. Restoring v1 backups remains supported; their first-answer history is unknown.

Prefer the API while the server is running. For direct SQLite edits, stop the server first, keep a backup, preserve `memory`, `due`, `state`, `reps`, and `version` consistency, then restart. Place data is cached in memory for fast reads. Never commit `data/local`, user exports, or review history. The server is intended for a trusted local machine, not exposure to a LAN or the public internet.
