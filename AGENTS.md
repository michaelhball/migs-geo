# Migs Geo development

This is a local-only app. Use the JSON API or CLI for collection management and testing; browser control is only needed for visual/interaction checks. See `API.md` and `GET /api/docs`. Do not read or modify the user's Anki installation; the app is independent.

The user prefers a simple functional interface with plain labels. Keep the primary navigation to Study, Browse, and Settings. Avoid marketing copy, unnecessary dashboards, and external services.

Keep personal progress and backups out of Git. `data/local/` is private runtime state. `data/places.json` is a public seed, not the live database. Do not overwrite a user's place edits or reset their schedule while changing the app. Tests must use temporary databases. Changes to seed data do not automatically migrate existing collections; apply narrowly scoped API updates where needed.

Node.js 24+, React, Vite, Leaflet canvas rendering, SQLite, and FSRS-6. `npm test`, `npx tsc --noEmit`, and `npm run build` are the checks. Integration tests start an isolated loopback server and may require sandbox network approval. `npm start` serves the production build at `127.0.0.1:4387`; `npm run dev` enables development mode.

The user has requested direct commits and pushes to `main`. Use that workflow unless a later task asks for a branch or PR. Commit only code and public reference data. Keep API documentation and tests current when changing behavior.
