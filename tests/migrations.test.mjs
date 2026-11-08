import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createStore } from "../server/store.mjs";
import { migrate, migrations, schemaVersion } from "../server/migrations.mjs";

test("fresh SQLite databases are initialized and migration reruns preserve data", () => {
  const s = createStore(":memory:");
  assert.equal(s.health().schemaVersion, schemaVersion);
  s.setSettings({ newPerDay: 27 });
  migrate(s.db);
  assert.equal(s.settings().newPerDay, 27);
  assert.equal(
    s.db.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  assert.equal(s.db.prepare("PRAGMA foreign_key_check").all().length, 0);
  s.db.close();
});

test("pre-versioned databases adopt migrations without losing settings", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(migrations[0]);
  db.prepare("INSERT INTO settings VALUES(1,?)").run('{"newPerDay":23}');
  migrate(db);
  assert.equal(
    db.prepare("PRAGMA user_version").get().user_version,
    schemaVersion,
  );
  assert.equal(
    db.prepare("SELECT data FROM settings").get().data,
    '{"newPerDay":23}',
  );
  db.close();
});

test("a failed migration rolls back both schema changes and the version", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  assert.throws(() =>
    migrate(db, [
      ...migrations,
      "CREATE TABLE incomplete(id INTEGER); INSERT INTO missing_table VALUES(1);",
    ]),
  );
  assert.equal(
    db.prepare("SELECT name FROM sqlite_master WHERE name='incomplete'").get(),
    undefined,
  );
  assert.equal(
    db.prepare("PRAGMA user_version").get().user_version,
    schemaVersion,
  );
  db.close();
});

test("opening a newer database with an older app fails explicitly", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`PRAGMA user_version = ${schemaVersion + 1}`);
  assert.throws(() => migrate(db), /newer than this app supports/);
  db.close();
});

test("adopting an existing on-disk database keeps a pre-migration snapshot", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "migs-geo-migrate-"));
  try {
    const file = path.join(dir, "geography.sqlite");
    let s = createStore(file);
    s.setSettings({ newPerDay: 31 });
    s.db.exec("PRAGMA user_version=0");
    s.db.close();
    s = createStore(file);
    assert.equal(s.settings().newPerDay, 31);
    assert.equal(s.health().schemaVersion, 1);
    const backup = readdirSync(path.join(dir, "backups")).find((f) =>
      f.includes("before-schema-v1"),
    );
    assert.ok(backup);
    s.db.close();
    const snapshot = new DatabaseSync(path.join(dir, "backups", backup), {
      readOnly: true,
    });
    assert.equal(snapshot.prepare("PRAGMA user_version").get().user_version, 0);
    assert.equal(
      JSON.parse(snapshot.prepare("SELECT data FROM settings").get().data)
        .newPerDay,
      31,
    );
    snapshot.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
