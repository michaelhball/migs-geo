import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createStore,
  checkAnswer,
  validateGeometry,
} from "../server/store.mjs";
const shape = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
  ],
};
const seed = ["alpha", "bravo", "charlie", "delta", "echo"].map((id) => ({
  id,
  name: id,
  kind: "country",
  region: "Test",
  info: "",
  aliases: [],
  tags: [],
  geometry: shape,
  center: [5, 5],
}));
function setup(count = 5) {
  let now = new Date("2026-11-09T10:00:00");
  const store = createStore(
    ":memory:",
    seed.slice(0, count),
    () => new Date(now),
  );
  return {
    store,
    setTime: (d) => (now = new Date(d)),
    advance: (ms) => (now = new Date(+now + ms)),
  };
}
function answer(s, rating = 3) {
  const q = s.question();
  assert.ok(q.card);
  s.check(
    q.token,
    q.card.mode === "locate"
      ? { point: [5, 5] }
      : { text: q.card.id.split(":")[0] },
  );
  return { q, result: s.review(q.token, rating) };
}

test("learning steps, next-day reviews, and daily new limits persist in the queue", () => {
  const { store: s, advance, setTime } = setup(2);
  s.setSettings({ newPerDay: 1, modes: ["locate"] });
  const { q } = answer(s, 3);
  assert.equal(s.getCard(q.card.id).state, 1);
  assert.equal(s.queue().counts.new, 0);
  assert.equal(s.question().card.id, q.card.id);
  advance(10 * 60 * 1000);
  assert.equal(s.queue().counts.learning, 1);
  answer(s, 3);
  assert.equal(s.getCard(q.card.id).state, 2);
  assert.equal(s.stats().today, 2);
  setTime("2026-11-10T04:00:00");
  assert.equal(s.queue().counts.new, 1);
  s.db.close();
});
test("short learning steps can finish immediately without altering stored due dates", () => {
  const { store: s } = setup(1);
  const { q } = answer(s, 1);
  const scheduled = s.getCard(q.card.id);
  assert.ok(scheduled.due > +new Date("2026-11-09T10:00:00"));
  assert.equal(s.question().card.id, q.card.id);
  assert.equal(s.queue().counts.learning, 1);
  assert.deepEqual(
    s.getCard(q.card.id),
    scheduled,
    "Reading an early repeat must not reschedule it.",
  );
  answer(s, 3);
  assert.equal(s.getCard(q.card.id).state, 1);
  assert.equal(s.question().card.id, q.card.id);
  answer(s, 3);
  assert.equal(s.getCard(q.card.id).state, 2);
  assert.equal(
    s.question().card,
    null,
    "Graduated reviews remain scheduled for a later day.",
  );
  assert.equal(s.stats().history[0].introduced, 1);
  assert.equal(s.stats().reviews, 3);
  s.db.close();
});

test("new and due cards take priority over early learning repeats", () => {
  const { store: s, setTime } = setup(3);
  s.setSettings({ modes: ["locate"] });
  const old = answer(s, 4).q.card.id;
  s.updateCard(old, { due: "2026-11-10T10:00:00" });
  setTime("2026-11-10T10:00:00");
  const learning = answer(s, 1).q.card.id;
  assert.equal(s.question().card.state, 0);
  answer(s, 4);
  assert.equal(s.question().card.id, old);
  answer(s, 4);
  assert.equal(s.question().card.id, learning);
  s.db.close();
});

test("daily review limit preserves deferred cards and resets at local 4am", () => {
  const { store: s, setTime } = setup(4);
  assert.equal(s.settings().reviewsPerDay, 200);
  s.setSettings({ modes: ["locate"], reviewsPerDay: 2 });
  const old = Array.from({ length: 3 }, () => answer(s, 4).q.card.id);
  for (const id of old) s.updateCard(id, { due: "2026-11-10T10:00:00" });
  s.setSettings({ newPerDay: 1 });
  setTime("2026-11-10T10:00:00");
  assert.equal(s.queue().counts.review, 2);
  assert.equal(s.queue().reviewLimit.deferred, 1);
  assert.equal(answer(s, 4).q.card.state, 0, "New cards still come first.");
  assert.equal(s.queue().reviewLimit.remaining, 2, "New cards use their own limit.");
  answer(s, 4);
  answer(s, 4);
  assert.equal(s.queue().counts.review, 0);
  assert.equal(s.question().card, null);
  assert.equal(s.question().reviewLimit.deferred, 1);
  const deferred = old.find(id => s.getCard(id).due === +new Date("2026-11-10T10:00:00"));
  assert.ok(deferred, "Deferred cards must not be rescheduled.");
  const saved = s.exportData();
  const restored = createStore(":memory:", [], () => new Date("2026-11-11T03:59:59"));
  restored.restore(saved);
  assert.equal(restored.queue().reviewLimit.remaining, 0);
  assert.equal(restored.question().card, null);
  restored.db.close();
  s.undo();
  assert.equal(s.queue().reviewLimit.remaining, 1, "Undo returns the allowance.");
  answer(s, 4);
  setTime("2026-11-11T03:59:59.999");
  assert.equal(s.queue().reviewLimit.remaining, 0);
  setTime("2026-11-11T04:00:00");
  assert.equal(s.queue().reviewLimit.remaining, 2);
  assert.equal(s.queue().counts.review, 1);
  assert.equal(s.queue().next.id, deferred);
  s.db.close();
});

test("a forgotten review can finish relearning after the daily review limit", () => {
  const { store: s, setTime } = setup(2);
  s.setSettings({ modes: ["locate"], reviewsPerDay: 1 });
  const old = Array.from({ length: 2 }, () => answer(s, 4).q.card.id);
  for (const id of old) s.updateCard(id, { due: "2026-11-10T10:00:00" });
  setTime("2026-11-10T10:00:00");
  const missed = answer(s, 1).q.card.id;
  assert.equal(s.queue().reviewLimit.reviewed, 1);
  assert.equal(s.queue().counts.review, 0);
  assert.equal(s.queue().counts.learning, 1);
  assert.equal(s.queue().next.id, missed);
  answer(s, 3);
  assert.equal(s.queue().reviewLimit.reviewed, 1);
  assert.equal(s.question().card, null);
  s.setSettings({ reviewsPerDay: 2 });
  assert.equal(s.queue().counts.review, 1, "Raising the limit releases deferred reviews.");
  const q = s.question();
  s.check(q.token, { reveal: true });
  s.setSettings({ reviewsPerDay: 1 });
  assert.throws(() => s.review(q.token, 3), /Daily review limit/);
  s.db.close();
});

test("older settings and backups default to 200 reviews without changing other settings", () => {
  const { store: s } = setup();
  const legacy = { ...s.settings(), newPerDay: 7 };
  delete legacy.reviewsPerDay;
  s.db.prepare("UPDATE settings SET data=?").run(JSON.stringify(legacy));
  assert.equal(s.settings().reviewsPerDay, 200);
  assert.equal(s.settings().newPerDay, 7);
  const backup = s.exportData();
  delete backup.settings.reviewsPerDay;
  s.restore(backup);
  assert.equal(s.settings().reviewsPerDay, 200);
  assert.equal(s.settings().newPerDay, 7);
  for (const reviewsPerDay of [-1, 1.5, 5001, null])
    assert.throws(() => s.setSettings({ reviewsPerDay }), /Reviews per day/);
  s.db.close();
});

test("early learning is bounded and respects paused cards and filters", () => {
  const { store: s } = setup(1);
  const id = answer(s, 1).q.card.id;
  s.updateCard(id, { due: "2026-11-11T10:00:00" });
  assert.equal(s.question().card, null);
  s.updateCard(id, { due: "2026-11-09T10:10:00", suspended: true });
  assert.equal(s.question().card, null);
  s.updateCard(id, { suspended: false });
  s.setSettings({ kinds: ["water"] });
  assert.equal(s.question().card, null);
  s.setSettings({ kinds: ["country"], newPerDay: 0 });
  assert.equal(s.question().card.id, id);
  s.db.close();
});

test("early repeats stay stable across reads and separate consecutive places", () => {
  const { store: s, advance } = setup();
  s.setSettings({ modes: ["locate"] });
  let previous;
  for (let i = 0; i < 5; i++) previous = answer(s, 1).q.card.id;
  for (let i = 0; i < 12; i++) {
    const q = s.question();
    assert.notEqual(q.card.id, previous);
    assert.equal(s.question().card.id, q.card.id);
    s.check(q.token, { reveal: true });
    s.review(q.token, 1);
    previous = q.card.id;
    advance(1000);
  }
  s.db.close();
});

test("Again schedules a short repeat; reviews still run when new limit is zero", () => {
  const { store: s, advance } = setup();
  const { q } = answer(s, 1);
  s.setSettings({ newPerDay: 0 });
  advance(60 * 1000);
  assert.equal(s.queue().next.id, q.card.id);
  assert.equal(s.queue().counts.learning, 1);
  s.db.close();
});
test("opposite directions are buried for today without suppressing learning repeats", () => {
  const { store: s, advance, setTime } = setup(1);
  const { q } = answer(s, 3);
  assert.equal(s.queue().counts.new, 0);
  advance(600000);
  assert.equal(s.queue().next.id, q.card.id);
  answer(s, 3);
  setTime("2026-11-10T10:00:00");
  assert.equal(s.queue().counts.new, 1);
  s.db.close();
});
test("practice and checks leave progress unchanged; duplicate ratings are idempotent", () => {
  const { store: s } = setup();
  const before = s.exportData();
  const q = s.question({ practice: true, placeId: "alpha", mode: "locate" });
  s.check(q.token, { point: [5, 5] });
  s.review(q.token, 3);
  const afterPractice = s.exportData();
  assert.deepEqual(afterPractice.cards, before.cards);
  assert.deepEqual(afterPractice.reviews, before.reviews);
  assert.equal(afterPractice.studyLog.attempts[0].practice, 1);
  const { q: scheduled } = answer(s);
  s.review(scheduled.token, 4);
  assert.equal(s.stats().reviews, 1);
  s.db.close();
});
test("concurrent questions cannot overwrite newer card state", () => {
  const { store: s } = setup();
  const a = s.question(),
    b = s.question();
  s.check(a.token, { reveal: true });
  s.check(b.token, { reveal: true });
  s.review(a.token, 1);
  assert.throws(() => s.review(b.token, 3), /another session/);
  s.db.close();
});
test("undo restores memory and daily allowance and preserves an audit record", () => {
  const { store: s } = setup();
  const q = s.question();
  const before = s.getCard(q.card.id);
  s.check(q.token, { reveal: true });
  s.review(q.token, 3);
  s.undo();
  const restored = s.getCard(q.card.id);
  assert.deepEqual(restored.memory, before.memory);
  assert.equal(s.stats().today, 0);
  assert.equal(s.history()[0].undone, 1);
  assert.ok(restored.version > before.version);
  s.db.close();
});
test("place edits preserve scheduling, archive is reversible, and pause excludes scheduled study", () => {
  const { store: s } = setup(1);
  const { q } = answer(s, 4);
  const memory = s.getCard(q.card.id).memory;
  s.updatePlace("alpha", { name: "Renamed", aliases: ["Other name"] });
  assert.deepEqual(s.getCard(q.card.id).memory, memory);
  s.updatePlace("alpha", { archived: true });
  assert.equal(s.question().card, null);
  s.updatePlace("alpha", { archived: false });
  s.updateCard("alpha:locate", { suspended: true });
  s.updateCard("alpha:identify", { suspended: true });
  assert.equal(s.queue().next, undefined);
  s.db.close();
});
test("export/restore roundtrips progress and fails atomically for invalid geometry", () => {
  const { store: s } = setup();
  const { q } = answer(s, 3);
  const data = s.exportData();
  const restored = createStore(":memory:");
  restored.restore(data);
  assert.equal(restored.stats().reviews, 1);
  assert.equal(restored.places().length, 5);
  assert.deepEqual(
    restored.getCard(q.card.id).memory,
    s.getCard(q.card.id).memory,
  );
  const bad = structuredClone(data);
  bad.places[0].geometry.coordinates[0][0] = [999, 0];
  assert.throws(() => restored.restore(bad));
  assert.equal(restored.stats().reviews, 1);
  s.db.close();
  restored.db.close();
});
test("SQLite survives restart, and a restore is not overwritten by seed data", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "migs-geo-test-")),
    file = path.join(dir, "test.sqlite");
  try {
    let s = createStore(file, seed);
    answer(s, 3);
    s.setSettings({ newPerDay: 8 });
    const nextId = s.question().card.id;
    s.db.close();
    s = createStore(file, seed);
    assert.equal(s.stats().reviews, 1);
    assert.equal(s.settings().newPerDay, 8);
    assert.equal(
      s.question().card.id,
      nextId,
      "Refreshing/restarting preserves the next shuffled new card.",
    );
    const data = s.exportData();
    data.places = [];
    data.cards = [];
    data.reviews = [];
    data.studyLog = { attempts: [], checks: [] };
    s.restore(data);
    s.db.close();
    s = createStore(file, seed);
    assert.equal(s.places().length, 0);
    s.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("regions are included by default and can still be filtered by place type", () => {
  const s = createStore(":memory:", [{ ...seed[0], kind: "region" }]);
  const q = s.question();
  assert.ok(q.card, "A region is eligible without changing settings.");
  s.check(q.token, { reveal: true });
  s.review(q.token, 4);
  assert.equal(s.getCard(q.card.id).reps, 1);
  s.setSettings({ kinds: ["country"], burySiblings: false });
  assert.equal(s.question().card, null);
  s.setSettings({ kinds: ["region"] });
  assert.ok(
    s.question().card,
    "Re-enabling regions includes the reverse card.",
  );
  s.db.close();
});

test("filters, validation, and custom point locations work through the store", () => {
  const { store: s } = setup();
  assert.throws(() => s.setSettings({ modes: [] }));
  assert.throws(() => s.setSettings({ retention: 1 }));
  assert.throws(() => s.setSettings({ newPerDay: -1 }));
  s.setSettings({ regions: ["Elsewhere"] });
  assert.equal(s.question().card, null);
  const p = s.createPlace({
    id: "baikal",
    name: "Lake Baikal",
    kind: "water",
    geometry: { type: "Point", coordinates: [108, 53.5] },
  });
  assert.equal(p.approximate, true);
  assert.equal(s.cards().filter((c) => c.place_id === p.id).length, 2);
  assert.equal(checkAnswer(p, "locate", { point: [100, 50] }).correct, null);
  s.db.close();
});
test("typing accepts case/accents/aliases but does not accept a different place", () => {
  const p = { ...seed[0], name: "Curaçao", aliases: ["Curacao"] };
  assert.equal(checkAnswer(p, "identify", { text: "CURACAO" }).correct, true);
  assert.equal(checkAnswer(p, "identify", { text: "Cuba" }).correct, false);
  assert.equal(checkAnswer(p, "locate", { point: [5, 5] }).correct, true);
  assert.equal(checkAnswer(p, "locate", { point: [15, 5] }).correct, false);
  assert.throws(() =>
    validateGeometry({
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
      ],
    }),
  );
});
test("available new cards come before the shuffled due reviews", () => {
  const { store: s, setTime } = setup();
  s.setSettings({ modes: ["locate"], burySiblings: false });
  for (let i = 0; i < 4; i++) answer(s, 4);
  const studied = s.cards().filter((c) => c.reps > 0);
  for (const c of studied) s.updateCard(c.id, { due: "2026-11-10T10:00:00" });
  s.updateCard(studied[1].id, { due: "2026-11-09T10:00:00" });
  setTime("2026-11-11T10:00:00");
  assert.equal(s.queue().next.state, 0);
  answer(s, 4);
  const nextDue = s.queue().next.id;
  assert.ok(studied.some((c) => c.id === nextDue));
  assert.equal(
    s.queue().next.id,
    nextDue,
    "Queue reads preserve the daily shuffled order.",
  );
  assert.equal(s.queue().next.state, 2);
  s.db.close();
});

test("new cards precede due learning repeats until the daily allowance is used", () => {
  const { store: s, advance } = setup();
  const { q } = answer(s, 1);
  advance(60000);
  assert.equal(s.queue().counts.learning, 1);
  assert.equal(s.question().card.state, 0);
  s.setSettings({ newPerDay: 1 });
  assert.equal(s.queue().counts.new, 0);
  assert.equal(s.question().card.id, q.card.id);
  s.db.close();
});

test("new cards mix directions independently of names, without long one-way runs", () => {
  const sameInitial = Array.from({ length: 30 }, (_, i) => ({
    ...seed[0],
    id: `alpha-${i}`,
    name: `alpha-${i}`,
  }));
  const s = createStore(
    ":memory:",
    sameInitial,
    () => new Date("2026-11-09T10:00:00"),
  );
  const directions = [],
    seen = new Set();
  for (let i = 0; i < 15; i++) {
    const q = s.question();
    assert.equal(
      q.card.id,
      s.question().card.id,
      "Queue reads must not reshuffle the current card.",
    );
    assert.equal(q.card.state, 0);
    const place = q.card.id.split(":")[0];
    assert.ok(!seen.has(place));
    seen.add(place);
    directions.push(q.card.mode);
    if (i >= 2)
      assert.ok(
        !(
          directions[i] === directions[i - 1] &&
          directions[i] === directions[i - 2]
        ),
        "Mix directions when both are available.",
      );
    s.check(q.token, { reveal: true });
    s.review(q.token, 4);
  }
  assert.equal(new Set(directions).size, 2);
  assert.equal(s.queue().counts.new, 0);
  assert.equal(s.question().card, null);
  s.db.close();
});

test("direction mixing respects a single enabled mode", () => {
  const { store: s } = setup();
  s.setSettings({ modes: ["identify"] });
  for (let i = 0; i < 5; i++)
    assert.equal(answer(s, 4).q.card.mode, "identify");
  assert.equal(s.question().card, null);
  s.db.close();
});

test("due reviews also mix directions, while respecting which cards are due", () => {
  const { store: s, setTime } = setup();
  s.setSettings({ newPerDay: 20, burySiblings: false });
  for (let i = 0; i < 10; i++) answer(s, 4);
  const dueCards = s.cards();
  for (const c of dueCards) s.updateCard(c.id, { due: "2026-11-10T10:00:00" });
  setTime("2026-11-11T10:00:00");
  const remaining = new Map(dueCards.map((c) => [c.id, c.mode])),
    modes = [];
  for (let i = 0; i < 10; i++) {
    const q = s.question();
    assert.equal(q.card.state, 2);
    assert.ok(remaining.has(q.card.id));
    const last = modes.slice(-2);
    if (
      last.length === 2 &&
      last[0] === last[1] &&
      [...remaining.values()].some((mode) => mode !== last[0])
    )
      assert.notEqual(q.card.mode, last[0]);
    remaining.delete(q.card.id);
    modes.push(q.card.mode);
    s.check(q.token, { reveal: true });
    s.review(q.token, 4);
  }
  assert.equal(s.question().card, null);
  assert.equal(new Set(modes).size, 2);
  s.db.close();
});

const atlas = JSON.parse(
  readFileSync(new URL("../data/places.json", import.meta.url)),
);
test("all 319 imported places have usable geometry and unique independent IDs", () => {
  assert.equal(atlas.length, 319);
  assert.equal(new Set(atlas.map((p) => p.id)).size, 319);
  for (const p of atlas) validateGeometry(p.geometry);
  assert.equal(atlas.filter((p) => p.approximate).length, 2);
});
test("Oceania covers its land and intervening ocean on both sides of the date line", () => {
  const p = atlas.find((p) => p.id === "oceania");
  assert.equal(p.geometry.type, "MultiPolygon");
  assert.equal(p.approximate, false);
  for (const [point, expected] of [
    [[134, -25], true], // Australia
    [[115.86, -31.95], true], // Perth
    [[147.33, -42.88], true], // Tasmania
    [[174.78, -41.29], true], // Wellington
    [[168.35, -46.41], true], // Southern New Zealand
    [[162, -32.5], true], // Tasman Sea, east of Australia
    [[147.18, -9.48], true], // Papua New Guinea
    [[171.38, 7.09], true], // Marshall Islands
    [[-157.86, 21.31], true], // Hawaii
    [[-149.56, -17.55], true], // Tahiti
    [[-109.35, -27.12], true], // Easter Island
    [[179.9, -20], true], [[-179.9, -20], true], // Date-line seam
    [[106.85, -6.2], false], // Jakarta
    [[120.98, 14.6], false], // Manila
    [[139.69, 35.68], false], // Tokyo
    [[-70.67, -33.45], false], // Chile
    [[0, 0], false], // No accidental polygon across the rest of the world
  ]) assert.equal(checkAnswer(p, "locate", { point }).correct, expected, point.join(","));
});
test("Balkan Peninsula is a regional outline and accepts its common name", () => {
  const p = atlas.find((p) => p.id === "balkan-peninsula");
  assert.equal(p.geometry.type, "MultiPolygon");
  assert.equal(p.approximate, false);
  assert.equal(p.small, false);
  assert.equal(checkAnswer(p, "identify", { text: "Balkans" }).correct, true);
  assert.equal(checkAnswer(p, "identify", { text: "Bulgaria" }).correct, false);
  for (const [point, expected] of [
    [[23.32, 42.7], true], // Sofia
    [[20.46, 44.7], true], // Serbia, south of Belgrade
    [[19.82, 41.33], true], // Tirana
    [[23.73, 37.98], true], // Athens
    [[26.55, 41.67], true], // Edirne, European Turkey
    [[26.1, 44.43], false], // Bucharest, north of the Danube
    [[32.85, 39.93], false], // Ankara, outside the peninsula
    [[12.5, 41.9], false], // Rome
  ]) assert.equal(checkAnswer(p, "locate", { point }).correct, expected, point.join(","));
});
test("representative map matches include constituent countries, territories, islands, water, and the date line", () => {
  const samples = [
    ["England", [-1, 52], true],
    ["England", [-4, 57], false],
    ["United Kingdom", [-4, 57], true],
    ["Serbia", [19.83, 45.27], true],
    ["Belgium", [4.35, 50.85], true],
    ["Bosnia and Herzegovina", [17.19, 44.77], true],
    ["Bali", [115.2, -8.4], true],
    ["Java", [110, -7], true],
    ["French Guiana", [-53, 4], true],
    ["Mediterranean Sea", [12, 35], true],
    ["Mediterranean Sea", [12.5, 41.9], false],
    ["Pacific Ocean", [-150, 0], true],
    ["Pacific Ocean", [160, 0], true],
    ["North America", [-100, 40], true],
  ];
  for (const [name, point, expected] of samples)
    assert.equal(
      checkAnswer(
        atlas.find((p) => p.name === name),
        "locate",
        { point },
      ).correct,
      expected,
      name,
    );
});
