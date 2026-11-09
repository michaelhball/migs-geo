import { readFileSync } from "node:fs";

export const migrations = [
  readFileSync(
    new URL("./migrations/001-initial.sql", import.meta.url),
    "utf8",
  ),
  readFileSync(
    new URL("./migrations/002-study-log.sql", import.meta.url),
    "utf8",
  ),
];
export const schemaVersion = migrations.length;

export function migrate(db, steps = migrations) {
  const current = db.prepare("PRAGMA user_version").get().user_version;
  if (current > steps.length) {
    throw Error(
      `Database schema ${current} is newer than this app supports (${steps.length}). Use a newer app version.`,
    );
  }
  if (current === steps.length) return current;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (let i = current; i < steps.length; i++) {
      db.exec(steps[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    }
    db.exec("COMMIT");
    return steps.length;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
