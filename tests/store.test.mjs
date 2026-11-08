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
  assert.equal(s.question().card, null);
  advance(10 * 60 * 1000);
  assert.equal(s.queue().counts.learning, 1);
  answer(s, 3);
  assert.equal(s.getCard(q.card.id).state, 2);
  assert.equal(s.stats().today, 2);
  setTime("2026-11-10T00:00:01");
  assert.equal(s.queue().counts.new, 1);
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
  assert.deepEqual(s.exportData(), before);
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
  const before = s.getCard("alpha:locate");
  answer(s, 3);
  s.undo();
  const restored = s.getCard("alpha:locate");
  assert.deepEqual(restored.memory, before.memory);
  assert.equal(s.stats().today, 0);
  assert.equal(s.history()[0].undone, 1);
  assert.ok(restored.version > before.version);
  s.db.close();
});
test("place edits preserve scheduling, archive is reversible, and pause excludes scheduled study", () => {
  const { store: s } = setup(1);
  answer(s, 4);
  const memory = s.getCard("alpha:locate").memory;
  s.updatePlace("alpha", { name: "Renamed", aliases: ["Other name"] });
  assert.deepEqual(s.getCard("alpha:locate").memory, memory);
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
  answer(s, 3);
  const data = s.exportData();
  const restored = createStore(":memory:");
  restored.restore(data);
  assert.equal(restored.stats().reviews, 1);
  assert.equal(restored.places().length, 5);
  assert.deepEqual(
    restored.getCard("alpha:locate").memory,
    s.getCard("alpha:locate").memory,
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
    s.db.close();
    s = createStore(file, seed);
    assert.equal(s.stats().reviews, 1);
    assert.equal(s.settings().newPerDay, 8);
    const data = s.exportData();
    data.places = [];
    data.cards = [];
    data.reviews = [];
    s.restore(data);
    s.db.close();
    s = createStore(file, seed);
    assert.equal(s.places().length, 0);
    s.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
test("new cards are interleaved with due reviews and overdue reviews sort first", () => {
  const { store: s, setTime } = setup();
  s.setSettings({ modes: ["locate"], burySiblings: false });
  for (let i = 0; i < 4; i++) answer(s, 4);
  for (const c of s.cards().filter((c) => c.reps > 0))
    s.updateCard(c.id, { due: "2026-11-10T10:00:00" });
  setTime("2026-11-11T10:00:00");
  assert.equal(s.queue().next.state, 2);
  answer(s, 3);
  answer(s, 3);
  answer(s, 3);
  assert.equal(s.queue().next.state, 0);
  s.db.close();
});

const atlas = JSON.parse(
  readFileSync(new URL("../data/places.json", import.meta.url)),
);
test("all 319 imported places have usable geometry and unique independent IDs", () => {
  assert.equal(atlas.length, 319);
  assert.equal(new Set(atlas.map((p) => p.id)).size, 319);
  for (const p of atlas) validateGeometry(p.geometry);
  assert.equal(atlas.filter((p) => p.approximate).length, 4);
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
