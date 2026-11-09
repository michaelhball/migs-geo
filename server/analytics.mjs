const parse = JSON.parse;
const percent = (n, total) =>
  total ? Math.round((n / total) * 1000) / 10 : null;
const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b),
    n = sorted.length;
  return n
    ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2
    : null;
};
const bins = [
  ["under-1m", "Under 1 min", 0, 60],
  ["1-10m", "1–10 min", 60, 600],
  ["10-60m", "10–60 min", 600, 3600],
  ["1-24h", "1–24 hr", 3600, 86400],
  ["1-3d", "1–3 days", 86400, 259200],
  ["3-7d", "3–7 days", 259200, 604800],
  ["7-30d", "7–30 days", 604800, 2592000],
  ["30d-plus", "30+ days", 2592000, Infinity],
];
const stages = ["new", "learning", "review", "relearning"];

function summarize(rows) {
  const assessed = rows.filter((r) => r.first && r.first.correct !== null);
  const correct = assessed.filter(
    (r) => r.first.correct && !r.first.revealed,
  ).length;
  const again = rows.filter((r) => r.grade === 1).length;
  return {
    reviews: rows.length,
    cards: new Set(rows.map((r) => r.card_id)).size,
    introduced: rows.filter((r) => r.is_new).length,
    firstAssessed: assessed.length,
    firstCorrect: correct,
    firstAccuracy: percent(correct, assessed.length),
    firstRevealed: rows.filter((r) => r.first?.revealed).length,
    selfGraded: rows.filter((r) => r.first?.correct === null).length,
    unknownFirst: rows.filter((r) => !r.first).length,
    again,
    againRate: percent(again, rows.length),
    ratedRecall: percent(rows.length - again, rows.length),
    medianResponseMs: median(rows.map((r) => r.response_ms)),
    medianIntervalSeconds: median(rows.map((r) => r.intervalSeconds)),
    earlyReviews: rows.filter((r) => r.earlySeconds > 0).length,
  };
}
function grouped(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const value = key(row);
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  }
  return [...groups].map(([id, group]) => ({ id, ...summarize(group) }));
}
function validateDate(value) {
  if (value === undefined) return;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(+new Date(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw Error("Use YYYY-MM-DD dates for statistics filters.");
}

export function analytics(db, places, cards, { from, to, cardId } = {}, today) {
  validateDate(from);
  validateDate(to);
  if (from && to && from > to)
    throw Error("The start date must not follow the end date.");
  const where = ["r.undone=0"],
    args = [];
  if (from) {
    where.push("r.day>=?");
    args.push(from);
  }
  if (to) {
    where.push("r.day<=?");
    args.push(to);
  }
  if (cardId) {
    where.push("r.card_id=?");
    args.push(cardId);
  }
  const records = db
    .prepare(
      `SELECT r.*, a.snapshot, a.started_at,
    f.at AS first_check_at, f.answer AS first_answer, f.result AS first_result, f.response_ms,
    (SELECT COUNT(*) FROM study_checks c WHERE c.attempt_id=a.id) AS check_count,
    (SELECT p.grade FROM reviews p WHERE p.card_id=r.card_id AND p.undone=0 AND p.rowid<r.rowid ORDER BY p.rowid DESC LIMIT 1) AS previous_rating
    FROM reviews r LEFT JOIN study_attempts a ON a.review_id=r.id
    LEFT JOIN study_checks f ON f.attempt_id=a.id AND f.sequence=1
    WHERE ${where.join(" AND ")} ORDER BY r.rowid`,
    )
    .all(...args);
  const placeMap = new Map(places.map((p) => [p.id, p]));
  const cardMap = new Map(cards.map((c) => [c.id, c]));
  const rows = records.map((r) => {
    const before = parse(r.before_card),
      snapshot = r.snapshot ? parse(r.snapshot) : null;
    const memory = snapshot?.card.memory || before.memory;
    const interval =
      r.is_new || !memory.last_review
        ? null
        : (+new Date(r.first_check_at || r.at) -
            +new Date(memory.last_review)) /
          1000;
    const due = snapshot?.card.due ?? before.due;
    return {
      ...r,
      mode: before.mode,
      place: snapshot?.place ||
        placeMap.get(r.place_id) || {
          name: r.place_id,
          kind: "unknown",
          region: "unknown",
          tags: [],
        },
      first: r.first_result ? parse(r.first_result) : null,
      answer: r.first_answer ? parse(r.first_answer) : null,
      intervalSeconds: interval !== null && interval >= 0 ? interval : null,
      scheduledIntervalSeconds: memory.last_review
        ? (due - +new Date(memory.last_review)) / 1000
        : null,
      earlySeconds: Math.max(
        0,
        (due - +new Date(r.first_check_at || r.at)) / 1000,
      ),
      stage: stages[memory.state],
    };
  });
  const byCard = grouped(rows, (r) => r.card_id)
    .map((group) => {
      const history = rows.filter((r) => r.card_id === group.id),
        last = history.at(-1),
        current = cardMap.get(group.id);
      return {
        ...group,
        placeId: last.place_id,
        name: placeMap.get(last.place_id)?.name || last.place.name,
        mode: last.mode,
        kind: last.place.kind,
        region: last.place.region,
        lastReviewedAt: last.at,
        due: current ? new Date(current.due).toISOString() : null,
        state: current?.state,
        lapses: current?.memory.lapses,
        stability: current?.memory.stability,
        recentRatings: history.slice(-8).map((r) => r.grade),
      };
    })
    .sort(
      (a, b) =>
        b.again - a.again ||
        (a.firstAccuracy ?? 100) - (b.firstAccuracy ?? 100) ||
        b.reviews - a.reviews,
    );
  const confusions = new Map();
  for (const r of rows) {
    if (
      r.mode !== "identify" ||
      r.first?.correct !== false ||
      r.first.revealed ||
      !r.answer?.text
    )
      continue;
    const answer = r.answer.text.trim(),
      key = `${r.card_id}\0${answer.toLowerCase()}`;
    const item = confusions.get(key) || {
      cardId: r.card_id,
      placeId: r.place_id,
      name: r.place.name,
      answer,
      count: 0,
    };
    item.count++;
    confusions.set(key, item);
  }
  const intervals = bins.map(([id, label, min, max]) => ({
    id,
    label,
    minSeconds: min,
    maxSeconds: Number.isFinite(max) ? max : null,
    ...summarize(
      rows.filter(
        (r) =>
          !r.is_new &&
          r.intervalSeconds !== null &&
          r.intervalSeconds >= min &&
          r.intervalSeconds < max,
      ),
    ),
  }));
  const tags = rows.flatMap((r) =>
    (r.place.tags || []).map((tag) => ({ ...r, tag })),
  );
  return {
    today,
    filters: { from: from || null, to: to || null, cardId: cardId || null },
    summary: summarize(rows),
    newCards: summarize(rows.filter((r) => r.is_new)),
    returns: summarize(rows.filter((r) => !r.is_new)),
    intervals,
    unknownIntervals: summarize(
      rows.filter((r) => !r.is_new && r.intervalSeconds === null),
    ),
    byMode: grouped(rows, (r) => r.mode),
    byKind: grouped(rows, (r) => r.place.kind),
    byRegion: grouped(rows, (r) => r.place.region),
    byTag: grouped(tags, (r) => r.tag),
    byStage: grouped(rows, (r) => r.stage),
    byPreviousRating: grouped(rows, (r) => r.previous_rating),
    daily: grouped(rows, (r) => r.day).sort((a, b) => a.id.localeCompare(b.id)),
    cards: byCard,
    ...(cardId
      ? {
          history: rows.map((r) => ({
            id: r.id,
            at: r.at,
            rating: r.grade,
            stage: r.stage,
            first: r.first,
            answer: r.answer,
            intervalSeconds: r.intervalSeconds,
            scheduledIntervalSeconds: r.scheduledIntervalSeconds,
            responseMs: r.response_ms,
            checks: r.check_count,
            previousRating: r.previous_rating,
          })),
        }
      : {}),
    confusions: [...confusions.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 100),
    mapErrors: rows
      .filter(
        (r) =>
          r.mode === "locate" && r.first?.correct === false && r.answer?.point,
      )
      .slice(-100)
      .reverse()
      .map((r) => ({
        cardId: r.card_id,
        placeId: r.place_id,
        name: r.place.name,
        at: r.first_check_at,
        point: r.answer.point,
        targetCenter: r.place.center,
        intervalSeconds: r.intervalSeconds,
        rating: r.grade,
      })),
    measurements: {
      firstAccuracy:
        "First check of a rated scheduled attempt; reveals count as unsuccessful. Self-graded answers and unrecorded legacy first checks are excluded.",
      ratedRecall:
        "Self-rating above Again, including older reviews. Separate from automatic first-answer correctness.",
      intervals:
        "Actual time from the previous rating to the first check (or rating time for legacy reviews), not the requested scheduling interval.",
      responseTime:
        "Time from question creation to first check, including pauses. Only recorded checks contribute.",
      scope:
        "Only active scheduled reviews; undone reviews, practice, and unrated attempts are excluded. Raw attempts remain available through /api/study/log.",
      classifications:
        "Original place classification where logged; current classification for legacy reviews. Tags can overlap.",
    },
  };
}
