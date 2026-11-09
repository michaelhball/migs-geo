import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/store.mjs";

const seed = [
  {
    id: "alpha",
    name: "Alpha",
    kind: "country",
    region: "Europe",
    tags: ["test"],
    aliases: [],
    info: "",
    geometry: { type: "Point", coordinates: [5, 5] },
    center: [5, 5],
  },
];
function setup() {
  let now = new Date("2026-11-09T10:00:00Z");
  const s = createStore(":memory:", seed, () => new Date(now));
  s.setSettings({ modes: ["identify"] });
  return { s, advance: (ms) => (now = new Date(+now + ms)) };
}
function rate(s, text, grade) {
  const q = s.question();
  s.check(q.token, { text });
  s.review(q.token, grade);
  return q;
}

test("first-try recall differs from final checks and self-rated recall", () => {
  const { s, advance } = setup();
  const q = s.question();
  advance(2000);
  s.check(q.token, { text: "Bravo" });
  advance(1000);
  s.check(q.token, { text: "Alpha" });
  s.review(q.token, 3);
  const a = s.analytics();
  assert.equal(a.summary.reviews, 1);
  assert.equal(a.summary.firstAccuracy, 0);
  assert.equal(a.summary.ratedRecall, 100);
  assert.equal(a.summary.medianResponseMs, 2000);
  assert.equal(a.newCards.reviews, 1);
  assert.equal(a.returns.reviews, 0);
  assert.equal(a.confusions[0].answer, "Bravo");
  assert.equal(a.confusions[0].count, 1);
  s.db.close();
});

test("retention buckets use actual elapsed time, including early learning", () => {
  const { s, advance } = setup();
  rate(s, "Alpha", 3);
  advance(30000);
  const q = s.question();
  advance(5000);
  s.check(q.token, { text: "Alpha" });
  s.review(q.token, 3);
  const a = s.analytics(),
    short = a.intervals.find((x) => x.id === "under-1m");
  assert.equal(short.reviews, 1);
  assert.equal(short.firstAccuracy, 100);
  assert.equal(short.medianIntervalSeconds, 35);
  assert.equal(short.earlyReviews, 1);
  assert.equal(a.intervals.find((x) => x.id === "10-60m").reviews, 0);
  assert.equal(a.byPreviousRating.find((x) => x.id === 3).reviews, 1);
  assert.equal(a.summary.reviews, 2);
  assert.equal(a.returns.reviews, 1);
  const history = s.analytics({ cardId: q.card.id }).history;
  assert.equal(history.length, 2);
  assert.equal(history[1].intervalSeconds, 35);
  assert.equal(history[1].first.correct, true);
  assert.equal(history[1].answer.text, "Alpha");
  advance(2 * 86400000);
  s.updateCard(q.card.id, {
    due: new Date("2026-11-11T09:00:00Z").toISOString(),
  });
  s.setSettings({ newPerDay: 0 });
  rate(s, "Bravo", 1);
  assert.equal(s.analytics().intervals.find((x) => x.id === "1-3d").reviews, 1);
  s.db.close();
});

test("reveals are misses, self-graded answers are separate, and practice/undo are excluded", () => {
  const { s } = setup();
  const q = s.question();
  s.check(q.token, { reveal: true });
  s.review(q.token, 1);
  let a = s.analytics();
  assert.equal(a.summary.firstRevealed, 1);
  assert.equal(a.summary.firstAccuracy, 0);
  s.undo();
  assert.equal(s.analytics().summary.reviews, 0);
  s.setSettings({ modes: ["locate"] });
  const map = s.question();
  s.check(map.token, { point: [4, 6] });
  s.review(map.token, 3);
  a = s.analytics();
  assert.equal(a.summary.selfGraded, 1);
  assert.equal(a.summary.firstAssessed, 0);
  assert.equal(a.summary.firstAccuracy, null);
  assert.equal(a.summary.ratedRecall, 100);
  const practice = s.question({
    practice: true,
    placeId: "alpha",
    mode: "identify",
  });
  s.check(practice.token, { text: "Alpha" });
  s.review(practice.token, 4);
  assert.equal(s.analytics().summary.reviews, 1);
  s.db.close();
});

test("legacy reviews retain ratings and interval history without invented first answers", () => {
  const { s } = setup();
  rate(s, "Alpha", 3);
  const legacy = s.exportData();
  legacy.version = 1;
  delete legacy.studyLog;
  s.restore(legacy);
  const a = s.analytics();
  assert.equal(a.summary.reviews, 1);
  assert.equal(a.summary.unknownFirst, 1);
  assert.equal(a.summary.firstAccuracy, null);
  assert.equal(a.summary.medianResponseMs, null);
  assert.equal(a.summary.ratedRecall, 100);
  assert.equal(a.cards[0].reviews, 1);
  const history = s.analytics({ cardId: a.cards[0].id }).history;
  assert.equal(history[0].first, null);
  assert.equal(history[0].rating, 3);
  s.db.close();
});

test("statistics use original classifications and honor date/card filters", () => {
  const { s, advance } = setup();
  const q = rate(s, "Alpha", 1);
  s.updatePlace("alpha", {
    region: "Asia",
    name: "Renamed",
    tags: ["new-tag"],
  });
  advance(86400000);
  s.setSettings({ newPerDay: 0 });
  rate(s, "Renamed", 3);
  const all = s.analytics();
  assert.equal(all.byRegion.find((x) => x.id === "Europe").reviews, 1);
  assert.equal(all.byRegion.find((x) => x.id === "Asia").reviews, 1);
  assert.equal(all.byTag.find((x) => x.id === "test").reviews, 1);
  assert.equal(all.cards[0].name, "Renamed");
  assert.equal(
    s.analytics({ from: "2026-11-10", to: "2026-11-10" }).summary.reviews,
    1,
  );
  assert.equal(s.analytics({ cardId: q.card.id }).summary.reviews, 2);
  assert.equal(s.analytics({ cardId: "missing" }).summary.reviews, 0);
  assert.throws(() => s.analytics({ from: "2026-02-30" }));
  assert.throws(() => s.analytics({ from: "2026-11-10", to: "2026-11-01" }));
  s.db.close();
});
