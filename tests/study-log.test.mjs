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

test("first answers, later checks, reveals, timing and original context are retained", () => {
  const { s, advance } = setup();
  const q = s.question();
  advance(3200);
  s.check(q.token, { text: "Bravo" });
  advance(1800);
  s.check(q.token, { text: "Alpha" });
  advance(500);
  s.check(q.token, { reveal: true });
  s.review(q.token, 1);
  s.review(q.token, 1);
  s.updatePlace("alpha", { name: "Changed", region: "World" });
  const log = s.studyLog().items[0];
  assert.equal(log.checks.length, 3);
  assert.deepEqual(
    log.checks.map((c) => c.result.correct),
    [false, true, false],
  );
  assert.deepEqual(
    log.checks.map((c) => c.response_ms),
    [3200, 5000, 5500],
  );
  assert.deepEqual(log.checks[0].answer, { text: "Bravo" });
  assert.equal(log.checks[2].result.revealed, true);
  assert.equal(log.snapshot.place.name, "Alpha");
  assert.equal(log.snapshot.place.region, "Europe");
  assert.equal(log.snapshot.card.state, 0);
  assert.equal(log.snapshot.settings.retention, 0.9);
  assert.equal(log.review_id, s.history()[0].id);
  assert.equal(s.stats().reviews, 1);
  const after = JSON.parse(s.exportData().reviews[0].after_card);
  assert.equal(after.state, s.getCard(q.card.id).state);
  assert.equal(after.due, +new Date(after.memory.due));
  assert.throws(
    () => s.check(q.token, { text: "Changed" }),
    /already been rated/,
  );
  s.undo();
  assert.equal(s.studyLog().items[0].undone, true);
  assert.equal(s.studyLog().items[0].checks.length, 3);
  s.db.close();
});

test("unrated questions and raw map selections persist without creating reviews", () => {
  const { s } = setup();
  s.setSettings({ modes: ["locate"] });
  const q = s.question();
  assert.throws(() => s.check(q.token, { point: [999, 0] }));
  assert.equal(s.studyLog().items[0].checks.length, 0);
  s.check(q.token, { point: [4, 6] });
  const log = s.studyLog().items[0];
  assert.deepEqual(log.checks[0].answer.point, [4, 6]);
  assert.equal(log.checks[0].result.correct, null);
  assert.equal(log.rating, null);
  assert.equal(s.stats().reviews, 0);
  const restored = createStore(":memory:");
  restored.restore(s.exportData());
  assert.deepEqual(restored.studyLog(), s.studyLog());
  restored.db.close();
  s.db.close();
});

test("a failed review rolls back both scheduling and its log link", () => {
  const { s } = setup();
  const q = s.question();
  s.check(q.token, { text: "Alpha" });
  const before = s.getCard(q.card.id);
  s.db.exec(
    "CREATE TRIGGER fail_review BEFORE INSERT ON reviews BEGIN SELECT RAISE(ABORT,'test failure'); END;",
  );
  assert.throws(() => s.review(q.token, 3), /test failure/);
  assert.deepEqual(s.getCard(q.card.id), before);
  assert.equal(s.studyLog().items[0].rating, null);
  assert.equal(s.studyLog().items[0].review_id, null);
  s.db.exec("DROP TRIGGER fail_review");
  s.review(q.token, 3);
  assert.equal(s.studyLog().items[0].rating, 3);
  s.db.close();
});

test("v2 backups retain the full log, reject invalid links atomically, and accept v1 history", () => {
  const { s } = setup();
  const q = s.question();
  s.check(q.token, { text: "Alpha" });
  s.review(q.token, 3);
  const backup = s.exportData();
  assert.equal(backup.version, 2);
  const restored = createStore(":memory:");
  restored.restore(backup);
  assert.deepEqual(restored.studyLog(), s.studyLog());
  const bad = structuredClone(backup);
  bad.studyLog.attempts[0].review_id = "missing";
  assert.throws(() => restored.restore(bad));
  assert.deepEqual(restored.studyLog(), s.studyLog());
  assert.equal(restored.stats().reviews, 1);
  const legacy = structuredClone(backup);
  legacy.version = 1;
  delete legacy.studyLog;
  restored.restore(legacy);
  assert.equal(restored.studyLog().total, 0);
  assert.equal(restored.stats().reviews, 1);
  restored.db.close();
  s.db.close();
});
