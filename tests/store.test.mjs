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
test("typed place names accept an ampersand for and", () => {
  const kitts = atlas.find(place => place.id === "saint-kitts-and-nevis");
  assert.equal(checkAnswer(kitts, "identify", {text:"Saint Kitts & Nevis"}).correct, true);
  assert.equal(checkAnswer(kitts, "identify", {text:"Saint Kitts & Tobago"}).correct, false);
  const trinidad = atlas.find(place => place.id === "trinidad-and-tobago");
  assert.equal(checkAnswer(trinidad, "identify", {text:"Trinidad&Tobago"}).correct, true);
});
test("the article in the two Congo republic names is optional", () => {
  const republic = atlas.find(p => p.id === "republic-of-the-congo");
  const democratic = atlas.find(p => p.id === "democratic-republic-of-the-congo");
  for (const [place, other, answer] of [
    [republic, democratic, "The Republic of Congo"],
    [democratic, republic, "Democratic Republic of Congo"],
  ]) {
    assert.equal(checkAnswer(place, "identify", {text:answer}).correct, true);
    assert.equal(checkAnswer(other, "identify", {text:answer}).correct, false);
    assert.equal(checkAnswer(place, "identify", {text:"Congo"}).correct, false);
  }
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
  const first = s.question({shuffle: "first-page"}).card.id;
  assert.equal(s.question({shuffle: "first-page"}).card.id, first);
  assert.ok(Array.from({length: 32}, (_, i) => s.question({shuffle: String(i)}).card.id).some(id => id !== first));
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
test("all bundled places have usable geometry and unique independent IDs", () => {
  assert.equal(atlas.length, 321);
  assert.equal(new Set(atlas.map((p) => p.id)).size, atlas.length);
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
    ["Hispaniola", [-72.34, 18.55], true], // Port-au-Prince, Haiti
    ["Hispaniola", [-69.92, 18.49], true], // Santo Domingo, Dominican Republic
    ["Hispaniola", [-72.81, 20.06], false], // Tortuga, offshore Haiti
    ["Hispaniola", [-68.70, 18.15], false], // Saona, offshore Dominican Republic
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

test("an open question survives restarts before and after checking and rating", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "migs-resume-"));
  const file = path.join(dir, "test.sqlite");
  let store = createStore(file, seed);
  try {
    const { token } = store.question();
    store.db.close();
    store = createStore(file);
    store.check(token, { reveal: true });
    store.db.close();
    store = createStore(file);
    const saved = store.review(token, 1);
    store.db.close();
    store = createStore(file);
    assert.deepEqual(store.review(token, 1).card, saved.card);
    assert.equal(store.stats().reviews, 1);
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("optional directions are isolated by deck and round-trip with ratings", () => {
  const store = createStore(":memory:", atlas.filter(p => p.id === "france"));
  assert.equal(store.cards().length, 2);
  for (const mode of ["capital","fromCapital","flag","fromFlag"]) {
    const flags = ["flag","fromFlag"].includes(mode);
    store.setSettings({modes:[mode], activeDeck:flags ? "flags" : "capitals", burySiblings:false});
    const q = store.question();
    assert.equal(q.card.mode,mode);
    const text = mode === "capital" ? "Paris" : "France";
    assert.ok(store.check(q.token,{text:mode === "flag" ? "france" : text}).correct);
    store.review(q.token,4);
  }
  const copy = createStore(":memory:");
  copy.restore(store.exportData());
  assert.equal(copy.history().length,4);
  assert.equal(copy.cards().length,6);
  copy.db.close();
  store.db.close();
});

test("capitals use their own daily allowance and keep their schedule when disabled", () => {
  const store = createStore(":memory:", atlas.filter(p => p.id === "france"));
  try {
    const modes = ["locate", "capital"];
    store.setSettings({modes, newPerDay:1});
    const map = store.question();
    assert.equal(map.card.mode, "locate");
    store.check(map.token, {reveal:true});
    store.review(map.token, 4);
    store.setSettings({activeDeck:"capitals", kinds:["water"]});
    const capital = store.question();
    assert.equal(capital.card.mode, "capital");
    assert.ok(store.check(capital.token, {text:"Paris"}).correct);
    store.review(capital.token, 4);
    const memory = store.getCard(capital.card.id).memory;
    assert.equal(store.setSettings({modes:["locate"]}).activeDeck, "geography");
    store.setSettings({modes, activeDeck:"capitals"});
    assert.deepEqual(store.getCard(capital.card.id).memory, memory);
    assert.equal(store.queue().counts.new, 0);
  } finally { store.db.close(); }
});

test("rivers opt in to traced and named cards and preserve submitted paths", () => {
  const s = createStore(":memory:", seed);
  assert.ok(!s.settings().kinds.includes("river"));
  s.setSettings({kinds:["river"],modes:["locate"]});
  const q = s.question();
  assert.ok(q.card.trace);
  const path = [[8,48],[14,47],[25,45]];
  assert.equal(s.check(q.token,{path}).correct,null);
  s.review(q.token,3);
  const backup = s.exportData();
  assert.deepEqual(JSON.parse(backup.studyLog.checks[0].answer),{path});
  s.restore(backup);
  s.setSettings({kinds:["range"],modes:["identify"]});
  assert.ok(["Polygon","MultiPolygon"].includes(s.question().card.geometry.type));
  s.db.close();
});

test("city packs switch countries without losing city progress", () => {
  const s = createStore(":memory:", []);
  assert.equal(s.settings().cityCountry,"");
  s.setSettings({cityCountry:"NZ",modes:["locate"]});
  const q = s.question(), place = s.place(q.card.id.split(":")[0]);
  assert.equal(place.countryCode,"NZ");
  assert.equal(s.check(q.token,{point:place.center}).correct,true);
  s.review(q.token,4);
  s.setSettings({cityCountry:"DE"});
  assert.equal(s.place(s.question().card.id.split(":")[0]).countryCode,"DE");
  s.setSettings({cityCountry:""});
  assert.equal(s.question().card,null);
  s.restore(s.exportData());
  assert.equal(s.getCard(q.card.id).reps,1);
  s.db.close();
});

test("multiple city countries share the geography queue and round-trip through backups", () => {
  const s = createStore(":memory:", []);
  try {
    const activeCities = () => s.editorial.list().filter(p => p.studying && p.id.startsWith("city-"));
    assert.deepEqual(s.settings().cityCountries, []);
    s.setSettings({cityCountries:["NZ","DE","NZ"]});
    assert.deepEqual(s.settings().cityCountries, ["NZ","DE"]);
    assert.equal(s.settings().cityCountry, "NZ");
    assert.equal(activeCities().length, 20);
    assert.deepEqual(new Set(activeCities().map(p => s.place(p.id).countryCode)), new Set(["NZ","DE"]));
    assert.equal(s.cards().length, 40);
    assert.throws(() => s.setSettings({cityCountries:["NZ","XX"]}), /country codes/);
    s.restore(s.exportData());
    assert.equal(activeCities().length, 20);
    s.setSettings({cityCountries:["DE"]});
    assert.equal(activeCities().length, 10);
    assert.ok(activeCities().every(p => s.place(p.id).countryCode === "DE"));
    const legacy = s.exportData();
    delete legacy.settings.cityCountries;
    s.restore(legacy);
    assert.deepEqual(s.settings().cityCountries, ["DE"]);
    s.setSettings({cityCountries:[]});
    assert.equal(s.question().card, null);
    assert.equal(s.cards().length, 40);
  } finally {
    s.db.close();
  }
});

test("desert cards check interior pins and keep their schedule when switched off", () => {
  const store = createStore(":memory:", []);
  try {
    store.setSettings({ kinds: ["desert"], modes: ["locate"] });
    const desert = store.place("desert-sahara");
    const { token } = store.question({ practice: true, placeId: desert.id, mode: "locate" });
    assert.equal(store.check(token, { point: [10, 23] }).correct, true);
    assert.equal(store.check(token, { point: [2, 49] }).correct, false);

    const scheduled = store.question();
    store.check(scheduled.token, { reveal: true });
    store.review(scheduled.token, 3);
    const card = store.getCard(scheduled.card.id);
    store.setSettings({ kinds: ["country"] });
    assert.equal(store.question().card, null);
    store.setSettings({ kinds: ["desert"] });
    assert.deepEqual(store.getCard(card.id), card);
    assert.equal(store.cards().length, 2 * store.places().length);
  } finally {
    store.db.close();
  }
});

test("enabling inland lakes adds both directions, matches the atlas and preserves existing reviews", () => {
  const store = createStore(":memory:", atlas);
  try {
    const original = store.question();
    store.check(original.token, { reveal: true });
    store.review(original.token, 3);
    const reviewed = store.getCard(original.card.id);
    const initialCount = store.cards().length;
    assert.ok(!store.settings().kinds.includes("lake"));
    store.setSettings({ kinds: ["lake"] });
    const lakes = store.places().filter(p => p.kind === "lake");
    assert.equal(lakes.length, 515);
    assert.equal(store.cards().length, initialCount + 2 * 511);
    assert.deepEqual(store.getCard(reviewed.id), reviewed);
    const world = JSON.parse(readFileSync(new URL("../public/data/world.json", import.meta.url)));
    const polygons = new Set(world.lakes.flatMap(b => b.geometry.coordinates.map(p => JSON.stringify(p))));
    for (const lake of lakes.filter(p => p.id.startsWith("lake-"))) {
      validateGeometry(lake.geometry);
      assert.ok(lake.geometry.coordinates.every(p => polygons.has(JSON.stringify(p))), lake.name);
      for (const mode of ["locate", "identify"]) assert.ok(store.getCard(lake.id + ":" + mode));
    }
    for (const name of ["Dead Sea", "Sea of Galilee", "Aral Sea", "Caspian Sea"])
      assert.equal(store.places().filter(p => p.name === name).length, 1);
    const taupo = lakes.find(p => p.name === "Lake Taupo");
    assert.equal(taupo.region, "Oceania");
    for (const text of ["Lake Taupō", "Taupo"])
      assert.equal(checkAnswer(taupo, "identify", { text }).correct, true);
    const baikal = lakes.find(p => p.name === "Lake Baikal");
    assert.equal(checkAnswer(baikal, "identify", { text: "Baikal" }).correct, true);
    assert.equal(checkAnswer(baikal, "locate", { point: [108, 53.5] }).correct, true);
    assert.equal(checkAnswer(baikal, "locate", { point: [0, 0] }).correct, false);
    const lakeCard = store.question();
    assert.equal(lakeCard.card.kind, "lake");
    store.check(lakeCard.token, { reveal: true });
    store.review(lakeCard.token, 3);
    const saved = store.getCard(lakeCard.card.id);
    store.setSettings({ kinds: ["country"] });
    store.setSettings({ kinds: ["lake"] });
    assert.deepEqual(store.getCard(saved.id), saved);
    store.restore(store.exportData());
    assert.deepEqual(store.getCard(saved.id).memory, saved.memory);
  } finally {
    store.db.close();
  }
});

test("approved place facts appear only after correct checks, including with legacy notes", () => {
  const place = atlas.find(p => p.id === "black-sea");
  const facts = JSON.parse(readFileSync(new URL("../data/approved-facts.json", import.meta.url)));
  const fact = facts[place.id];
  const store = createStore(":memory:", [{...place, info: "Personal note. " + fact.text}]);
  try {
    const q = store.question({practice:true, placeId:place.id, mode:"identify"});
    assert.equal(q.card.placeFact, undefined);
    for (const answer of [{text:"Baltic Sea"}, {reveal:true}]) {
      const result = store.check(q.token, answer);
      assert.equal(result.placeFact, undefined);
      assert.equal(result.place.info, "Personal note.");
    }
    assert.deepEqual(store.check(q.token, {text:"Black Sea"}).placeFact, fact);
  } finally {
    store.db.close();
  }
});

test("lake names accept the geographic term on either end", () => {
  const lake = {name:"Lake Hammar",kind:"lake",aliases:[]};
  for (const text of ["Hammar Lake","The lake Hammar","Hammar"])
    assert.equal(checkAnswer(lake,"identify",{text}).correct,true);
  assert.equal(checkAnswer({...lake,name:"Hammar Lake"},"identify",{text:"Lake Hammar"}).correct,true);
  for (const text of ["Lake Hammer","Lake","Lake Huron"])
    assert.equal(checkAnswer(lake,"identify",{text}).correct,false);
});

test("fact drafts, follow-ups and publication are independent of schedules", () => {
  const s=createStore(":memory:",atlas);
  try {
    const review=s.editorial, item=review.list().find(p=>p.id==="aral-sea");
    assert.ok(item.options.length >= 3);
    const fields={choice:item.options[0].id,comment:"Please shorten",hold:true};
    review.save(item.id,{...fields,revision:0});
    assert.throws(()=>review.save(item.id,{...fields,revision:0}),/changed/);
    assert.deepEqual(review.publish().applied,[]);
    review.save(item.id,{...fields,hold:false,revision:1});
    assert.equal(review.current(item.id),null);
    assert.deepEqual(review.publish().applied,[item.id]);
    assert.deepEqual(review.publish().applied,[]);
    // A collection pass may publish while the reviewer is typing in the same tab.
    review.save(item.id,{...fields,hold:false,revision:2,comment:"Shorten the last line"});
    assert.equal(review.current(item.id).text,item.options[0].text);
    assert.throws(()=>review.save(item.id,{...fields,revision:2}),/changed/);
    const saved=s.exportData();s.restore(saved);
    assert.deepEqual(s.editorial.backup(),saved.factReview);
    const q=s.question({practice:true,placeId:item.id,mode:"identify"});
    assert.equal(s.check(q.token,{text:"Aral Sea"}).placeFact.text,item.options[0].text);
  } finally {s.db.close()}
});

test("a lake cutoff partitions scheduled cards and preserves small-lake reviews", () => {
  const s=createStore(":memory:",[]);
  try{
    s.setSettings({kinds:["lake"],modes:["locate"]});
    const q=s.question();s.check(q.token,{reveal:true});s.review(q.token,3);
    const card=s.getCard(q.card.id),index=s.lakeReview();
    assert.equal(index.cutoff,0);assert.ok(index.lakes.every(l=>Number.isFinite(l.area)&&l.area>0));
    s.setSettings({lakeCutoffKm2:1000000});
    assert.equal(s.question().card,null);
    s.setSettings({kinds:["smallLake"]});assert.ok(s.question().card);
    assert.deepEqual(s.getCard(card.id),card);
    const largest=Math.max(...index.lakes.map(l=>l.area));
    s.setSettings({lakeMinimumKm2:largest});
    assert.equal(s.question().card.id,index.lakes.find(l=>l.area===largest).id+":locate");
    s.setSettings({lakeMinimumKm2:largest+1});assert.equal(s.question().card,null);
    assert.deepEqual(s.getCard(card.id),card);
    assert.throws(()=>s.setSettings({lakeMinimumKm2:1000001}),/minimum/);
    s.setSettings({lakeCutoffKm2:0,lakeMinimumKm2:0});assert.equal(s.question().card,null);
  }finally{s.db.close()}
});

test("fact review includes custom places before candidates exist", () => {
  const s=createStore(":memory:",seed);
  try {
    const review=s.editorial;
    assert.deepEqual(review.list().find(p=>p.id==="alpha").options,[]);
    assert.equal(review.list().find(p=>p.id==="alpha").studying,true);
    s.setSettings({kinds:["water"]});
    assert.equal(review.list().find(p=>p.id==="alpha").studying,false);
    const draft={revision:0,choice:null,comment:"Research the name",hold:true};
    review.save("alpha",draft);
    assert.equal(review.list().find(p=>p.id==="alpha").comment,draft.comment);
    assert.throws(()=>review.save("bravo",{...draft,choice:"invented"}),/Unknown candidate/);
    assert.throws(()=>review.save("unknown",draft),/Unknown fact review place/);
    assert.deepEqual(review.publish().applied,[]);
  } finally {s.db.close()}
});

test("considering a fourth candidate preserves the choice until an explicit switch and publication", () => {
  const s=createStore(":memory:",atlas);
  try {
    const review=s.editorial;
    const item=()=>review.list().find(p=>p.id==="aral-sea");
    const [first,,,alternative]=item().options;
    const save=fields=>review.save(item().id,{revision:item().revision,choice:item().choice,comment:"",hold:false,...fields});
    save({choice:first.id});
    review.publish();
    assert.equal(item().reviewedAlternative,null);
    assert.throws(()=>save({reviewedAlternative:first.id}),/alternative has changed/);
    save({reviewedAlternative:alternative.id});
    save({comment:"Keep for now"});
    s.restore(s.exportData());
    assert.equal(item().reviewedAlternative,alternative.id);
    assert.equal(item().choice,first.id);
    assert.deepEqual(review.publish().applied,[]);
    save({choice:alternative.id,reviewedAlternative:alternative.id});
    assert.equal(item().current.text,first.text);
    assert.deepEqual(review.publish().applied,[item().id]);
    assert.equal(item().current.text,alternative.text);
  } finally {s.db.close()}
});

test("requests for new suggestions survive reloads until the whole shortlist changes", () => {
  const s=createStore(":memory:",atlas);
  try {
    const review=s.editorial, id="aral-sea";
    const item=()=>review.list().find(p=>p.id===id);
    const ids=item().options.map(o=>o.id);
    const fields={choice:null,comment:"Please try again",hold:false};
    review.save(id,{...fields,revision:0,seenOptions:ids});
    assert.equal(item().awaitingSuggestions,true);
    const backup=s.exportData();
    s.restore(backup);
    assert.equal(item().awaitingSuggestions,true);
    const oldIds=ids.map((_,i)=>String(i).padStart(24,"0"));
    review.save(id,{...fields,revision:1,requestNewOptions:true,seenOptions:[ids[1],...oldIds.slice(1)]});
    assert.equal(item().awaitingSuggestions,true);
    review.save(id,{...fields,revision:2,requestNewOptions:true,seenOptions:oldIds});
    assert.equal(item().newSuggestions,true);
    assert.equal(item().hold,false);
    review.save(id,{...fields,revision:3,choice:ids[0]});
    assert.deepEqual(review.publish().applied,[id]);
    assert.equal(item().comment,fields.comment);
    review.save(id,{...fields,revision:item().revision,hold:true});
    assert.equal(item().awaitingSuggestions,true);
  } finally { s.db.close(); }
});

test("vocabulary uses a separate optional queue and retains reviewed words across restore", () => {
  const {store} = setup();
  const restored = setup().store;
  try {
    const glossary = store.vocabulary();
    assert.match(glossary.find(w => w.term === "peat").definition, /plant/i);
    assert.equal(new Set(glossary.map(w => w.id)).size, glossary.length);
    assert.ok(store.cards().every(c => !c.place_id.startsWith("vocab-")));
    store.setSettings({modes:["identify","term"], newPerDay:1});
    assert.equal(store.question().card.kind, "country");
    store.setSettings({activeDeck:"vocabulary", regions:["elsewhere"]});
    const q = store.question();
    const word = store.place(store.getCard(q.card.id).place_id);
    assert.equal(q.card.definition, word.info);
    assert.equal(q.card.name, null);
    assert.equal(store.check(q.token,{text:word.name}).correct, true);
    store.review(q.token,4);
    assert.equal(store.queue().counts.new, 0);
    store.setSettings({modes:["identify","define"]});
    const pick = store.question({practice:true, placeId:"vocab-peat", mode:"define"});
    const definition = store.place("vocab-peat").info;
    assert.equal(pick.card.name,"peat");
    assert.equal(new Set(pick.card.definitions).size,4);
    assert.ok(pick.card.definitions.includes(definition));
    assert.equal(store.check(pick.token,{text:pick.card.definitions.find(x => x !== definition)}).correct,false);
    assert.equal(store.check(pick.token,{text:definition}).correct,true);
    store.review(pick.token,3);
    store.setSettings({modes:["identify"],regions:[]});
    assert.equal(store.settings().activeDeck,"geography");
    assert.equal(store.queue().counts.new,1);
    restored.restore(store.exportData());
    assert.deepEqual(restored.getCard(q.card.id).memory,store.getCard(q.card.id).memory);
    assert.equal(restored.review(q.token,4).card.id,q.card.id);
    store.updatePlace("vocab-peat",{info:"Waterlogged plant remains."});
    store.setSettings({modes:["identify","term"]});
    assert.equal(store.vocabulary().find(w => w.term === "peat").definition,"Waterlogged plant remains.");
  } finally {
    store.db.close();
    restored.db.close();
  }
});

test("all river fact choices are available before their cards are enabled", () => {
  const {store} = setup();
  try {
    const rivers = store.editorial.list().filter(p => p.id.startsWith("river-"));
    assert.equal(rivers.length,45);
    assert.ok(rivers.every(r => !r.studying && r.options.length >= 3 && r.options.every(o => o.text && o.source.startsWith("https://"))));
    const river = rivers.find(r => r.id === "river-murray");
    store.editorial.save(river.id,{revision:river.revision,choice:river.options[0].id,comment:"",hold:false});
    assert.deepEqual(store.editorial.publish().applied,[river.id]);
    store.setSettings({kinds:["river"],modes:["identify"]});
    const q = store.question({practice:true, placeId:river.id,mode:"identify"});
    assert.equal(store.check(q.token,{text:river.name}).placeFact.text,river.options[0].text);
  } finally {
    store.db.close();
  }
});

test("US states are optional and share Alaska and Hawaii's original card histories", () => {
  const s = createStore(":memory:", atlas);
  try {
    const original = s.settings();
    const studied = () => s.editorial.list().filter(p => p.studying);
    const before = studied().length;
    assert.ok(!original.kinds.includes("usState"));
    assert.ok(!s.cards().some(c => c.place_id.startsWith("us-state-")));
    s.updateCard("alaska:identify", {suspended:true});
    const alaska = s.getCard("alaska:identify");
    s.setSettings({kinds:[...original.kinds,"usState"]});
    assert.equal(studied().length, before + 48);
    assert.deepEqual(s.getCard("alaska:identify"), alaska);
    s.setSettings({kinds:["usState"]});
    assert.equal(studied().length, 50);
    const ids = new Set(studied().map(p => p.id));
    assert.equal(s.cards().filter(c => ids.has(c.place_id)).length, 100);
    for (const placeId of ["alaska","hawaii","us-state-ga","us-state-ri"]) {
      const q = s.question({practice:true,placeId,mode:"identify"});
      assert.equal(q.card.kind,"usState");
      assert.ok(q.card.geometry);
      assert.equal(q.card.name,null);
      assert.equal(s.check(q.token,{text:s.place(placeId).name}).correct,true);
    }
    const q = s.question({practice:true,placeId:"us-state-ga",mode:"locate"});
    assert.equal(q.card.name,"Georgia");
    assert.equal(q.card.geometry,null);
    assert.equal(s.check(q.token,{point:[-84.39,33.75]}).correct,true);
    const wrong = s.check(q.token,{point:[-86.8,33.52]});
    assert.equal(wrong.correct,false);
    assert.match(wrong.message,/Alabama/);
    const scheduled = s.question();
    assert.equal(scheduled.card.kind,"usState");
    s.check(scheduled.token,{reveal:true});
    s.review(scheduled.token,3);
    const memory = s.getCard(scheduled.card.id).memory;
    s.restore(s.exportData());
    s.setSettings({kinds:original.kinds});
    assert.equal(studied().length,before);
    s.setSettings({kinds:["usState"]});
    assert.deepEqual(s.getCard(scheduled.card.id).memory,memory);
    assert.equal(studied().length,50);
  } finally {
    s.db.close();
  }
});

test("Canadian and Australian subdivision packs are independent and preserve reviews", () => {
  const s = createStore(":memory:", []);
  try {
    const packs = ["canadaProvince", "australiaState"];
    assert.ok(packs.every(k => !s.settings().kinds.includes(k)));
    const active = () => s.editorial.list().filter(p => p.studying);
    const cases = [
      ["canadaProvince",13,"ca-province-on",[-75.69,45.42],[-73.57,45.5],"Quebec"],
      ["australiaState",8,"au-state-act",[149.13,-35.28],[151.21,-33.87],"New South Wales"],
    ];
    for (const [kind,count,id,inside,outside,other] of cases) {
      s.setSettings({kinds:[kind]});
      assert.equal(active().length,count);
      const q = s.question({practice:true,placeId:id,mode:"locate"});
      assert.equal(q.card.kind,kind);
      assert.equal(q.card.geometry,null);
      const [w,south,e,north] = q.card.mapBounds;
      assert.ok(inside[0]>w && inside[0]<e && inside[1]>south && inside[1]<north);
      assert.equal(s.check(q.token,{point:inside}).correct,true);
      assert.equal(s.check(q.token,{point:outside}).message,"Your pin is in "+other+".");
      const card = s.question({practice:true,placeId:id,mode:"identify"});
      assert.equal(card.card.name,null);
      assert.deepEqual(card.card.mapBounds,q.card.mapBounds);
      assert.equal(s.check(card.token,{text:s.place(id).name}).correct,true);
      const scheduled=s.question();
      s.check(scheduled.token,{reveal:true});
      s.review(scheduled.token,3);
    }
    s.setSettings({kinds:packs});
    assert.equal(active().length,21);
    s.restore(s.exportData());
    assert.equal(s.cards().filter(c=>c.reps>0).length,2);
    s.setSettings({kinds:["country"]});
    assert.equal(active().length,0);
    s.setSettings({kinds:["usState",...packs]});
    assert.equal(active().length,71);
    assert.equal(s.cards().length,142);
  } finally {s.db.close();}
});
