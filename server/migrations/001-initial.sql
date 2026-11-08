-- Idempotent adoption also supports databases created before versioned migrations.
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS places (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id),
  mode TEXT NOT NULL,
  memory TEXT NOT NULL,
  due INTEGER NOT NULL,
  state INTEGER NOT NULL,
  reps INTEGER NOT NULL DEFAULT 0,
  suspended INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS cards_due ON cards(state, due);
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  place_id TEXT NOT NULL,
  at TEXT NOT NULL,
  day TEXT NOT NULL,
  grade INTEGER NOT NULL,
  correct INTEGER,
  is_new INTEGER NOT NULL,
  before_card TEXT NOT NULL,
  after_card TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  undone INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS reviews_day ON reviews(day, undone);
