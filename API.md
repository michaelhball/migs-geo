# Migs Geo API

The UI, CLI, and agents use the same API at `http://127.0.0.1:4387/api`. It binds to loopback by default; there is no cloud service, Anki dependency, or browser requirement. `GET /api/docs` returns the machine-readable OpenAPI contract. Requests that change data use `Content-Type: application/json`. Errors return a non-2xx status and `{ "error": "…" }`. Docker and future hosting configuration are described in [DEPLOYMENT.md](DEPLOYMENT.md).

The server accepts same-origin browser API requests and local CLI clients. JSON bodies have a 256 KiB limit, or 40 MiB for place geometry and backup restores. Oversized requests return HTTP 413.

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
| GET | `/api/cards` | Full scheduling state; optional `?placeId=france`. `dueDay` is the YYYY-MM-DD study date for review cards, or null for new/short learning cards. |
| GET | `/api/cards/:id` | One card, FSRS memory state, and `dueDay` |
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

Kinds: `country`, `territory`, `water`, `region`; all four are enabled by default. The `region` kind covers broader places such as continents and Scandinavia. The separate `region` field is any string used by the “Parts of the world” study filter; an empty `settings.regions` array includes the whole world. Display notes are plain text; imported HTML is displayed without markup. Typed names and aliases treat “&” and “and” as equivalent and ignore case, accents, other punctuation, and an initial “the”. The article after “Republic of” is optional, so “The Republic of Congo” matches “Republic of the Congo”.

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

For a naming question, use `"answer":{"text":"France"}`. To reveal, use `"answer":{"reveal":true}`. For a missed map answer, the feedback message names the mapped country, territory or water containing the pin when available. Approximate map markers return `correct:null`. Duplicate rating requests using the same token return the original result without another review. A stale card version rejects the rating. Question tokens survive a server restart. An open study tab can continue checking or rating the same question.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/queue` | Current counts, next card ID, next learning time, `studyDay`, `nextDayAt`, server-local `timeZone`, and `reviewLimit` |
| GET | `/api/stats` | Counts, daily review history, recall ratings |
| GET | `/api/analytics` | First-try recall, actual interval buckets, daily activity, difficult cards, classifications, and wrong-answer patterns; optional `from`, `to` (inclusive YYYY-MM-DD study dates) and `cardId`. A `cardId` filter also returns chronological `history` with ratings, first answers, and actual/planned intervals, including legacy reviews with unknown first answers. |
| GET | `/api/reviews` | Review history, including undone records |
| POST | `/api/reviews/undo` | Undo the last active review; preserve an audit record |
| GET | `/api/study/log` | Persistent attempts and ordered answer checks; `cardId`, `limit` (1–500), `offset`, and `includePractice=true` filters |
| GET | `/api/backup` | Full versioned JSON export, including places, cards, settings, review history, and the study log |
| POST | `/api/restore` | Restore that export atomically; server first saves a SQLite snapshot of existing data |

## Scheduling

FSRS-6, through the pinned `ts-fsrs` dependency. Default target retention: 90%; learning: 1 minute / 10 minutes; relearning: 10 minutes. New limit: 15 cards per study day, from 04:00 to the following 04:00 in the server computer's local timezone. Available new cards take priority until that daily allowance is used, including after a refresh or restart. Both new and due cards are shuffled independently of place names; the default API order is stable across queue reads and restarts. An optional `shuffle` string on `POST /api/study/next` reorders eligible due cards. The browser generates one on each page load. When both directions are available in the current group, the next card switches direction after two consecutive reviews in the same direction. This respects the enabled modes and sibling separation.

After new cards, due learning and review cards are mixed in a shuffled queue. Review cards due before the next 04:00 boundary are eligible, excluding cards already reviewed in the current study day. When those queues are empty, learning and relearning cards due within the next 10 minutes can be studied immediately. These early repeats are shuffled after each rating and avoid repeating the same place back-to-back when another is available. `counts.learning` includes these available short-step cards. Queue reads do not change due dates; FSRS uses the actual rating time. Long-term reviews and learning cards scheduled more than 10 minutes ahead remain scheduled. The daily review limit is `settings.reviewsPerDay` (default 200, integer 0–5000). It counts distinct cards rated from the long-term review state during the local study day, across all filters and both directions. New cards and short learning/relearning steps do not count. Undo restores the allowance. Deferred reviews keep their original due dates and become available after the 04:00 reset or an increase to the limit. Zero pauses long-term reviews while allowing new cards and short learning steps. Existing collections and older backups default to 200 without changing their other settings or schedules. By default, the reverse of a place studied today waits until tomorrow. Both directions keep separate scheduling state. New-card allowances, sibling burial, shuffling, daily history, and analytics all roll over at local 04:00, including daylight-saving changes. A review at 01:00 belongs to the previous study date. New day-based schedules use the target study day's 04:00 start; existing due timestamps are preserved and interpreted within the same day window. Historical review dates are regrouped on migration and restore; exact timestamps, ratings, and scheduling memory are retained.

Browsing, checks, and answer reveals do not change the schedule. Only a rating on a scheduled question does. Ratings of long-term review cards also enforce the current daily limit, including questions opened before the limit was reached. Review dates and memory states persist across restarts. Suspended cards and archived places are excluded from scheduled study. Unscheduled practice is not exposed in the interface; explicit API practice requests remain available for testing and can intentionally include paused cards without changing progress.

`GET /api/queue`, `GET /api/stats`, and an empty `POST /api/study/next` response include `reviewLimit: {limit, reviewed, remaining, deferred}`. `deferred` counts otherwise eligible long-term reviews beyond today's remaining allowance; `counts.review` counts those available within it.

Interval previews return `days` as a whole number for day-based reviews and `null` for short learning steps. `seconds` is the actual time until the returned `due` timestamp, which can be less than 24 hours for a one-day interval. Use `days` for the rating-button label. Long intervals remain whole days rather than approximate months or years.

## Direct data access

Analytics include active scheduled ratings only. They exclude undone reviews, unscheduled practice, and unrated attempts. `summary.firstAccuracy` uses the first recorded check; reveals count as unsuccessful, while self-graded results and missing legacy first checks are excluded. `ratedRecall` is the separate percentage of self-ratings above Again. Every group includes sample counts and unknown coverage. An interval measures actual elapsed time from the previous rating to the first check, or to the rating for legacy reviews; it is not the planned delay. New introductions are reported separately from return attempts. Classification uses the original snapshot where available and current place metadata for older reviews. Raw answers and uncompleted attempts remain accessible through `/api/study/log`.

Each question and valid answer check is logged even if it is never rated. The log preserves raw typed answers or map coordinates, reveals, correctness, time since the question was shown (including pauses), the original place classification, card memory, and study settings. The first check remains identifiable after subsequent checks. Ratings link atomically to reviews; undo retains the log with `undone:true`. Re-rating the same token is idempotent, and checks after rating are rejected. Explicit API practice is logged separately and excluded by default. Older reviews have no invented first-answer records.

Runtime data: `data/local/geography.sqlite` (override with `GEO_DATA_DIR`). Tables: `places`, `cards`, `reviews`, `study_attempts`, `study_checks`, `settings`, and `meta`. Foreign keys, WAL, and transactions protect saves. Scheduling memory is versioned JSON inside SQLite. The public `data/places.json` is an initial seed, loaded once, not the live database. Exported backups use `format:"migs-geo", version:2` and include a `studyLog` object with raw `attempts` and `checks` rows. Restoring v1 backups remains supported; their first-answer history is unknown.

Prefer the API while the server is running. For direct SQLite edits, stop the server first, keep a backup, preserve `memory`, `due`, `state`, `reps`, and `version` consistency, then restart. Place data is cached in memory for fast reads. Never commit `data/local`, user exports, or review history. The server is intended for a trusted local machine, not exposure to a LAN or the public internet.

Optional question directions are `capital` (type the capital), `fromCapital` (name the place), `flag` (choose a flag), and `fromFlag` (name the place). Enable directions through settings.modes. Select their separate queues with `settings.activeDeck` set to `capitals` or `flags`. The default `geography` queue uses `locate` and `identify`. Map place-type selections apply to Geography. The region filter also applies to flags and capitals. Disabling the last direction of an active optional deck returns study to Geography. Each deck has its own daily allowance at the configured limits. Enabling directions creates separate cards only for applicable places. Disabling a direction retains its memory. Flag choices return {id,flag}; submit the chosen id in answer.text. Other text prompts accept answer.text.

Optional Geography place types `river` and `range` add Natural Earth paths and areas on first enable. River locate questions set `card.trace` and accept `answer.path`, an ordered list of at least two longitude/latitude pairs. The checked path is logged and compared visually with the atlas course; the user grades recall. Range questions use polygon checks.

The independent subdivision packs are `usState` (50 US states), `canadaProvince` (10 Canadian provinces and 3 territories), and `australiaState` (6 Australian states plus the Northern Territory and Australian Capital Territory). Add their keys to `settings.kinds` to enable them in Geography. All are off by default. Removing a pack preserves its schedules. Alaska and Hawaii reuse their original territory cards. The atlas shows internal boundaries one zoom-button step in from the fitted world view, regardless of study settings.

Both question directions return the subdivision’s `card.kind` and a question viewport in `card.mapBounds` as `[west, south, east, north]` in degrees. The viewport covers the country, with regional views for Alaska and Hawaii. Locate questions return the name and withhold the target geometry until the answer check.

Set `settings.cityCountries` to an array of supported ISO two-letter country codes, for example `["NZ","DE"]`, to study up to ten cities per country in Geography. An empty array switches city study off. Removing and re-adding countries preserves their card schedules. The legacy `cityCountry` field reads the first selected code or an empty string. Patching that field alone replaces the selection with one country or clears it. When both fields are supplied, `cityCountries` takes precedence. City locate answers accept pins within 25 km of the reference point.

The opt-in physical atlas offers 45 named river courses, 36 mountain ranges and 24 desert areas. Choose `river`, `range`, or `desert` in settings.kinds. The bundled geometry comes from Natural Earth; deserts and ranges accept pins inside their mapped area.

The optional `lake` kind installs 511 named inland-water places (1,022 independent locate and identify cards) from the atlas lake layer. Select **Inland lakes** under Settings → Place types, or include `lake` in `settings.kinds`. Turning the type off pauses its questions and preserves its cards. Existing water cards such as the Dead Sea and Aral Sea keep their original IDs and schedules.

The marine filter (`water`) includes oceans, seas, gulfs, bays, and straits. The Aral Sea, Caspian Sea, Dead Sea, and Sea of Galilee are classified as `lake`. Together with the optional pack this gives 515 lake places.

For places with an entry in `data/approved-facts.json`, a correct study check includes `placeFact: {text, source}`. Wrong answers, reveals and self-graded checks omit this field.

## Fact review

Open `/fact-review.html?scope=rivers` to review the bundled rivers before enabling them for study. Use `/fact-review.html?scope=held` to review held selections that differ from the fact on the card. Requests still awaiting new options stay hidden. Clearing the hold makes the selected fact eligible for the next publication. Choosing a review scope only filters the editor.

Open `/fact-review.html` or use `GET /api/fact-review` for every unarchived collection place and every researched shortlist, including optional places with candidates. Entries awaiting research have an empty `options` array and accept comments. The `studying` field follows enabled place types, lake thresholds, regions, modes, deck and card suspension. The review page prioritizes researched places in current study settings and groups saved selections in Already chosen. Whole collection includes other places. Update one place with `PUT /api/fact-review/:id` and its current `revision`, candidate `choice` ID (or null), `comment` and boolean `hold`. A request for replacement facts hides the place from the review list. Holding an unselected place, writing “please try again”, or sending `requestNewOptions: true` records the candidate IDs the reviewer saw (optional `seenOptions`). The API keeps the comments and options available for research. It returns `awaitingSuggestions: true` until three fresh options replace the old set, then returns `newSuggestions: true` and releases the hold. Conflicting draft revisions return 409. An edit can still save if only publication occurred since the editor read its draft. `POST /api/fact-review/publish {}` atomically publishes selected, unheld changes to SQLite. Repeating publication is safe. Comments stay in the review record. Full collection backups include the private decisions. Add researched candidates to `server/fact-candidates.json`; changed wording receives a new choice ID and requires reselection before publication.

The review page offers a comparison for every saved A, B or C choice with an unreviewed fourth candidate. Places on hold stay out of the comparison queue. To acknowledge the offer, include the fourth candidate's ID as `reviewedAlternative` in the usual PUT. Keep the same `choice` to dismiss it, or set `choice` to D to switch drafts. Omitting `reviewedAlternative` preserves any previous acknowledgement. A replacement D has a new ID and can be offered again. Publication remains explicit.

## Lake review

Open `/lake-review.html` or query `GET /api/lake-review` to review the bundled lakes, estimated areas in square kilometres, and approximate country hints. Previewing a cutoff is read-only. Apply it with `PATCH /api/settings {"lakeCutoffKm2":5000,"lakeMinimumKm2":200}`. A lake with area equal to or above the cutoff uses `lake`; one below uses `smallLake` down to and including `lakeMinimumKm2`. Lakes below that second threshold stay in Browse and are excluded from scheduled study. Both settings default to zero. These are independent queue filters. Lake places retain their original kind, IDs and scheduling. A zero cutoff includes all sizes under Inland lakes.

Run `node scripts/collect-fact-review.mjs` for a single editorial collection pass. It publishes eligible selections through the local API and saves held places, retry requests and comments in `data/local/fact-review-inbox.json`. Each entry includes the selected text and whether replacement suggestions are pending or already available. Comments remain available after a request is fulfilled. The command can run on a timer while the server is running. Set `GEO_URL` and `GEO_DATA_DIR` when using a different local instance.

## Geography vocabulary

`GET /api/vocabulary` lists the words, definitions, groups and accepted aliases before the pack is installed. The searchable list is at `/vocabulary.html`. Add `term` (type the word for a definition) and/or `define` (select a definition for a word) to the existing settings modes to enable the optional pack. Then set `activeDeck` to `vocabulary` to study it. Disabling both directions returns the active deck to geography. The daily limits are counted per deck. Word cards use the same check, rate, logging, backup and restore endpoints as geography cards.

Vocabulary entries use `kind: "vocabulary"`, a word in `name`, its definition in `info`, a topic group in `region`, and null geometry and center. Installed entries and custom words can be managed through the places and cards API.

## City populations

`GET /api/populations` lists the city, country, number of people, reference year, boundary, and source without installing any cards. The deck starts disabled. Add `population` to `settings.modes` and select `settings.activeDeck = "populations"` to study it separately. Removing the mode retains all schedules. A population question gives the city, country, year and boundary. Submit `answer.text` in people (e.g. `420,000`, `420k` or `0.42 million`). The inclusive tolerance is ±25% of the reference. Checks and reveals return `population` with the rounded label, source and memory cue. The study log keeps the original answer and the reference used to assess it.

Installed records use `kind: "population"`, country in `region`, an HTTPS `source`, null geometry and center, and `population: {people, year, area}`. Use the regular places API to add a city or revise a reference.
