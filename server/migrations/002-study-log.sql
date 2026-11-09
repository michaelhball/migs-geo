CREATE TABLE IF NOT EXISTS study_attempts (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  place_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('locate', 'identify')),
  practice INTEGER NOT NULL CHECK(practice IN (0, 1)),
  started_at TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  review_id TEXT UNIQUE REFERENCES reviews(id),
  rating INTEGER CHECK(rating BETWEEN 1 AND 4),
  rated_at TEXT
);
CREATE INDEX IF NOT EXISTS study_attempts_card ON study_attempts(card_id, started_at);
CREATE INDEX IF NOT EXISTS study_attempts_started ON study_attempts(started_at);
CREATE TABLE IF NOT EXISTS study_checks (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES study_attempts(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  at TEXT NOT NULL,
  answer TEXT NOT NULL,
  result TEXT NOT NULL,
  response_ms INTEGER NOT NULL CHECK(response_ms >= 0),
  UNIQUE(attempt_id, sequence)
);
