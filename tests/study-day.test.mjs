import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStore } from "../server/store.mjs";
import { studyDay, nextStudyDay } from "../server/study-day.mjs";

const seed = ["alpha", "bravo"].map((id) => ({
  id, name: id, kind: "country", region: "Test", tags: [], aliases: [],
  info: "", geometry: { type: "Point", coordinates: [1, 2] }, center: [1, 2],
}));
function setup(at = "2026-11-08T23:50:00") {
  let now = new Date(at);
  const s = createStore(":memory:", seed, () => new Date(now));
  s.setSettings({ newPerDay: 1 });
  return { s, setTime: (at) => now = new Date(at) };
}
function answer(s, grade = 4) {
  const q = s.question();
  const check = s.check(q.token, { reveal: true });
  return { q, check, saved: s.review(q.token, grade) };
}

test("study days change at 04:00, including month and year boundaries", () => {
  assert.equal(studyDay(new Date("2026-11-09T03:59:59.999")), "2026-11-08");
  assert.equal(studyDay(new Date("2026-11-09T04:00:00")), "2026-11-09");
  assert.equal(studyDay(new Date("2027-01-01T01:00:00")), "2026-12-31");
  assert.equal(+nextStudyDay(new Date("2027-01-01T01:00:00")), +new Date("2027-01-01T04:00:00"));
});

test("daily quota, sibling burial, statistics, and old review dates share the 4am boundary", () => {
  const { s, setTime } = setup();
  const { q } = answer(s);
  // An existing midnight-based schedule stays stored as-is but becomes
  // available at the start of its new study day.
  s.updateCard(q.card.id, { due: "2026-11-10T01:00:00" });
  for (const at of ["2026-11-09T00:00:00", "2026-11-09T03:59:59.999"]) {
    setTime(at);
    assert.equal(s.queue().counts.new, 0);
    assert.equal(s.queue().counts.review, 0);
    assert.equal(s.stats().today, 1);
    assert.equal(s.analytics().today, "2026-11-08");
  }
  s.setSettings({ newPerDay: 2 });
  assert.equal(s.queue().counts.new, 1, "The sibling remains buried before 4am.");
  setTime("2026-11-09T04:00:00");
  assert.equal(s.queue().counts.new, 2, "Both places are available in the new day.");
  assert.equal(s.queue().counts.review, 1);
  assert.equal(s.stats().today, 0);
  assert.equal(s.queue().studyDay, "2026-11-09");
  assert.equal(s.queue().nextDayAt, new Date("2026-11-10T04:00:00").toISOString());
  assert.equal(s.stats().history[0].day, "2026-11-08");
  s.updateCard(q.card.id, { due: "2026-11-10T04:00:00" });
  assert.equal(s.queue().counts.review, 0, "The next boundary is exclusive.");
  s.db.close();
});

test("late-night ratings use study dates and expose whole-day intervals", () => {
  const { s, setTime } = setup("2026-11-09T01:00:00");
  const { check, saved } = answer(s);
  const easy = check.intervals.find((i) => i.rating === 4);
  assert.ok(Number.isInteger(easy.days) && easy.days >= 1);
  assert.equal(easy.due.getHours(), 4);
  assert.equal(saved.card.due, +easy.due);
  assert.equal(saved.card.memory.scheduled_days, easy.days);
  assert.equal(s.history()[0].day, "2026-11-08");
  assert.equal(check.intervals[0].days, null);
  assert.equal(check.intervals[0].seconds, 60);
  assert.equal(s.analytics({ from: "2026-11-08", to: "2026-11-08" }).summary.reviews, 1);
  assert.equal(s.analytics({ from: "2026-11-09" }).summary.reviews, 0);
  const due = new Date(saved.card.due);
  setTime(new Date(+due - 1));
  assert.equal(s.queue().counts.review, 0);
  setTime(due);
  assert.equal(s.queue().counts.review, 1);
  s.db.close();
});

test("old backups and databases regroup reviews without changing timestamps or memory", () => {
  const { s } = setup("2026-11-09T01:00:00");
  answer(s);
  const backup = s.exportData();
  backup.reviews[0].day = "2026-11-09";
  const exactTime = backup.reviews[0].at;
  const restored = createStore(":memory:");
  restored.restore(backup);
  assert.equal(restored.history()[0].day, "2026-11-08");
  assert.equal(restored.history()[0].at, exactTime);
  assert.deepEqual(restored.exportData().studyLog, backup.studyLog);
  assert.deepEqual(restored.cards().map(c => c.memory), backup.cards.map(c => c.memory));
  const dir = mkdtempSync(path.join(tmpdir(), "migs-geo-day-"));
  try {
    const file = path.join(dir, "geography.sqlite");
    restored.backup(file);
    const old = new DatabaseSync(file);
    old.exec("UPDATE reviews SET day='2026-11-09'; PRAGMA user_version=3");
    old.close();
    let updated = createStore(file);
    assert.equal(updated.history()[0].day, "2026-11-08");
    assert.equal(updated.history()[0].at, exactTime);
    assert.deepEqual(updated.exportData().studyLog, backup.studyLog);
    assert.deepEqual(updated.cards().map(c => c.memory), backup.cards.map(c => c.memory));
    assert.ok(readdirSync(path.join(dir, "backups")).some(f => f.includes("before-schema-v4")));
    updated.db.close();
    updated = createStore(file);
    assert.equal(updated.history()[0].day, "2026-11-08", "Migration must not shift the day twice.");
    updated.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
    restored.db.close();
    s.db.close();
  }
});

test("4am rollover and one-day scheduling use local calendar days across DST", () => {
  const code = `
    import assert from 'node:assert/strict';
    import { studyDay, nextStudyDay, scheduleStudyDay } from './server/study-day.mjs';
    for (const [at, tomorrow, hours] of [
      ['2026-03-28T04:00:00', '2026-03-29T04:00:00', 23],
      ['2026-10-24T04:00:00', '2026-10-25T04:00:00', 25],
    ]) {
      const now = new Date(at), due = new Date(tomorrow);
      assert.equal(+nextStudyDay(now), +due);
      assert.equal((due - now) / 3600000, hours);
      assert.equal(+scheduleStudyDay({state:2, scheduled_days:1}, now).due, +due);
      assert.equal(studyDay(new Date(+due - 1)), at.slice(0, 10));
      assert.equal(studyDay(due), tomorrow.slice(0, 10));
    }
    for (const at of ['2026-10-25T02:30:00+02:00', '2026-10-25T02:30:00+01:00']) {
      assert.equal(studyDay(new Date(at)), '2026-10-24');
    }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    cwd: new URL("..", import.meta.url), env: { ...process.env, TZ: "Europe/Berlin" }, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});
