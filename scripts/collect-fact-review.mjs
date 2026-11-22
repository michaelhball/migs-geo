// One local collection pass. The server owns all decisions and study progress.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const base = new URL(process.env.GEO_URL || "http://127.0.0.1:4387");
if (base.protocol !== "http:" || !["127.0.0.1", "[::1]", "localhost"].includes(base.hostname)) {
  throw new Error("Fact collection requires a local Migs Geo server.");
}
const directory = resolve(process.env.GEO_DATA_DIR || fileURLToPath(new URL("../data/local/", import.meta.url)));

async function api(route, options) {
  const res = await fetch(new URL(route, base), {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    ...options,
  });
  if (!res.ok) throw new Error(`Request to ${route} failed (HTTP ${res.status}).`);
  return res.json();
}

const { applied } = await api("/api/fact-review/publish", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
});
const places = await api("/api/fact-review");
const entries = places.filter(p => p.awaitingSuggestions || p.hold || p.comment.trim()).map(p => ({
  id: p.id,
  name: p.name,
  revision: p.revision,
  studying: p.studying,
  awaitingSuggestions: Boolean(p.awaitingSuggestions),
  newSuggestions: Boolean(p.newSuggestions),
  held: p.hold,
  comment: p.comment,
  selected: p.options.find(option => option.id === p.choice)?.text ?? null,
}));
const output = JSON.stringify(entries, null, 2) + "\n";
await mkdir(directory, { recursive: true, mode: 0o700 });
const path = join(directory, "fact-review-inbox.json");
let previous;
try {
  previous = await readFile(path, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (previous !== output) {
  const temp = path + `.${process.pid}.tmp`;
  await writeFile(temp, output, { mode: 0o600 });
  await rename(temp, path);
}
console.log(JSON.stringify({ published: applied, awaitingSuggestions: entries.filter(p => p.awaitingSuggestions).map(p => p.id) }));
