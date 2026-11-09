import { randomUUID } from "node:crypto";

const encode = JSON.stringify,
  parse = JSON.parse;
const validDate = (value) =>
  typeof value === "string" && Number.isFinite(+new Date(value));

export function createStudyLog(db, clock) {
  const insertAttempt = db.prepare(
    "INSERT INTO study_attempts VALUES(?,?,?,?,?,?,?,?,?,?)",
  );
  const insertCheck = db.prepare(
    "INSERT INTO study_checks VALUES(?,?,?,?,?,?,?)",
  );
  const exportData = () => ({
    attempts: db.prepare("SELECT * FROM study_attempts ORDER BY rowid").all(),
    checks: db.prepare("SELECT * FROM study_checks ORDER BY rowid").all(),
  });
  return {
    start(id, card, place, settings, practice) {
      const { name, kind, region, tags, approximate, center, aliases } = place;
      insertAttempt.run(
        id,
        card.id,
        card.place_id,
        card.mode,
        practice ? 1 : 0,
        clock().toISOString(),
        encode({
          place: { name, kind, region, tags, approximate, center, aliases },
          card: {
            state: card.state,
            due: card.due,
            memory: card.memory,
            version: card.version,
          },
          settings,
        }),
        null,
        null,
        null,
      );
    },
    check(id, answer, result) {
      const now = clock();
      const attempt = db
        .prepare("SELECT started_at FROM study_attempts WHERE id=?")
        .get(id);
      const sequence = db
        .prepare(
          "SELECT COALESCE(MAX(sequence),0)+1 AS n FROM study_checks WHERE attempt_id=?",
        )
        .get(id).n;
      const submitted = answer.reveal
        ? { reveal: true }
        : typeof answer.text === "string"
          ? { text: answer.text }
          : { point: answer.point };
      insertCheck.run(
        randomUUID(),
        id,
        sequence,
        now.toISOString(),
        encode(submitted),
        encode(result),
        Math.max(0, +now - +new Date(attempt.started_at)),
      );
    },
    rate(id, rating, reviewId = null) {
      db.prepare(
        "UPDATE study_attempts SET rating=?, rated_at=?, review_id=? WHERE id=?",
      ).run(rating, clock().toISOString(), reviewId, id);
    },
    list({ cardId, limit = 100, offset = 0, includePractice = false } = {}) {
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 500 ||
        !Number.isInteger(offset) ||
        offset < 0
      )
        throw Error("Use a limit of 1–500 and a non-negative offset.");
      const where = [includePractice ? "1=1" : "a.practice=0"],
        args = [];
      if (cardId) {
        where.push("a.card_id=?");
        args.push(cardId);
      }
      const filter = where.join(" AND ");
      const total = db
        .prepare(`SELECT COUNT(*) AS n FROM study_attempts a WHERE ${filter}`)
        .get(...args).n;
      const rows = db
        .prepare(
          `SELECT a.*, COALESCE(r.undone,0) AS undone FROM study_attempts a
        LEFT JOIN reviews r ON a.review_id=r.id WHERE ${filter} ORDER BY a.rowid DESC LIMIT ? OFFSET ?`,
        )
        .all(...args, limit, offset);
      const checks = db.prepare(
        "SELECT * FROM study_checks WHERE attempt_id=? ORDER BY sequence",
      );
      return {
        total,
        limit,
        offset,
        items: rows.map((a) => ({
          ...a,
          snapshot: parse(a.snapshot),
          practice: !!a.practice,
          undone: !!a.undone,
          checks: checks.all(a.id).map((c) => ({
            ...c,
            answer: parse(c.answer),
            result: parse(c.result),
          })),
        })),
      };
    },
    exportData,
    clear() {
      db.exec("DELETE FROM study_checks; DELETE FROM study_attempts;");
    },
    restore(data) {
      for (const a of data.attempts)
        insertAttempt.run(
          a.id,
          a.card_id,
          a.place_id,
          a.mode,
          a.practice,
          a.started_at,
          a.snapshot,
          a.review_id,
          a.rating,
          a.rated_at,
        );
      for (const c of data.checks)
        insertCheck.run(
          c.id,
          c.attempt_id,
          c.sequence,
          c.at,
          c.answer,
          c.result,
          c.response_ms,
        );
    },
  };
}

export function validateStudyLog(data, cardIds, placeIds, reviews) {
  if (!data || !Array.isArray(data.attempts) || !Array.isArray(data.checks))
    throw Error("Invalid study log in backup.");
  const attempts = new Map(),
    reviewIds = new Set(),
    checkIds = new Set(),
    sequences = new Set();
  for (const a of data.attempts) {
    if (
      typeof a.id !== "string" ||
      !a.id ||
      attempts.has(a.id) ||
      !cardIds.has(a.card_id) ||
      !placeIds.has(a.place_id) ||
      !["locate", "identify"].includes(a.mode) ||
      a.card_id !== `${a.place_id}:${a.mode}` ||
      ![0, 1].includes(a.practice) ||
      !validDate(a.started_at) ||
      ![null, 1, 2, 3, 4].includes(a.rating) ||
      (a.rated_at !== null && !validDate(a.rated_at)) ||
      (a.rating === null) !== (a.rated_at === null)
    )
      throw Error("Invalid study attempt in backup.");
    const snapshot = parse(a.snapshot);
    if (
      !snapshot?.place ||
      typeof snapshot.place.name !== "string" ||
      typeof snapshot.place.region !== "string" ||
      !["country", "territory", "water", "region"].includes(
        snapshot.place.kind,
      ) ||
      !Array.isArray(snapshot.place.tags) ||
      snapshot.place.tags.some((tag) => typeof tag !== "string") ||
      !snapshot.card?.memory ||
      ![0, 1, 2, 3].includes(snapshot.card.state) ||
      !Number.isFinite(snapshot.card.due) ||
      !snapshot.settings
    )
      throw Error("Invalid study snapshot in backup.");
    if (a.review_id !== null) {
      const r = reviews.get(a.review_id);
      if (
        a.practice ||
        !r ||
        r.card_id !== a.card_id ||
        r.grade !== a.rating ||
        reviewIds.has(a.review_id)
      )
        throw Error("Study attempt belongs to another review.");
      reviewIds.add(a.review_id);
    } else if (!a.practice && a.rating !== null)
      throw Error("Rated study attempt is missing its review.");
    attempts.set(a.id, a);
  }
  for (const c of data.checks) {
    const attempt = attempts.get(c.attempt_id),
      key = `${c.attempt_id}:${c.sequence}`;
    if (
      typeof c.id !== "string" ||
      !c.id ||
      checkIds.has(c.id) ||
      !attempt ||
      sequences.has(key) ||
      !Number.isInteger(c.sequence) ||
      c.sequence < 1 ||
      !validDate(c.at) ||
      !Number.isInteger(c.response_ms) ||
      c.response_ms < 0
    )
      throw Error("Invalid answer check in backup.");
    const answer = parse(c.answer),
      result = parse(c.result);
    if (!result || ![true, false, null].includes(result.correct))
      throw Error("Invalid check result in backup.");
    const point = answer?.point;
    if (
      !answer ||
      !(
        answer.reveal === true ||
        (attempt.mode === "identify" && typeof answer.text === "string") ||
        (attempt.mode === "locate" &&
          Array.isArray(point) &&
          point.length === 2 &&
          point.every(Number.isFinite) &&
          Math.abs(point[0]) <= 180 &&
          Math.abs(point[1]) <= 90)
      )
    )
      throw Error("Invalid submitted answer in backup.");
    checkIds.add(c.id);
    sequences.add(key);
  }
  for (const a of data.attempts)
    if (a.rating !== null && !sequences.has(`${a.id}:1`))
      throw Error("Rated attempt has no first answer.");
  for (const c of data.checks)
    if (c.sequence > 1 && !sequences.has(`${c.attempt_id}:${c.sequence - 1}`))
      throw Error("Study checks must have a continuous sequence.");
}
