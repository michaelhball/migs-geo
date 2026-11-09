import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { request as httpRequest } from "node:http";
import { schemaVersion } from "../server/migrations.mjs";

test(
  "HTTP API supports an agent-driven collection, study, and backup workflow",
  { timeout: 30000 },
  async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "migs-geo-api-"));
    const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    const child = spawn(process.execPath, ["server/index.mjs"], {
      cwd: root,
      env: { ...process.env, PORT: "0", GEO_DATA_DIR: dir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    t.after(async () => {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await new Promise((resolve) => child.once("exit", resolve));
      }
      rmSync(dir, { recursive: true, force: true });
    });
    const base = await new Promise((resolve, reject) => {
      let text = "";
      child.stdout.on("data", (chunk) => {
        text += chunk;
        const match = text.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) resolve(match[0]);
      });
      child.once("exit", (code) =>
        reject(Error(`Server exited ${code}: ${stderr}`)),
      );
    });
    async function call(route, method = "GET", data, extraHeaders = {}) {
      const response = await fetch(base + "/api" + route, {
        method,
        headers: { "Content-Type": "application/json", ...extraHeaders },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      return { status: response.status, body: await response.json() };
    }
    assert.equal((await call("/health")).body.ok, true);
    assert.equal((await call("/health")).body.database, "ok");
    assert.equal((await call("/health")).body.schemaVersion, schemaVersion);
    // Deliberately split the UTF-8 sequence for é across HTTP chunks.
    const payload = Buffer.from(
      JSON.stringify({
        id: "unicode-test",
        name: "Café 日本",
        geometry: { type: "Point", coordinates: [1, 2] },
      }),
    );
    const split = payload.indexOf(Buffer.from("é")) + 1;
    const unicode = await new Promise((resolve, reject) => {
      const req = httpRequest(
        base + "/api/places",
        { method: "POST", headers: { "Content-Type": "application/json" } },
        (res) => {
          let result = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (result += chunk));
          res.on("end", () => resolve(JSON.parse(result)));
        },
      );
      req.on("error", reject);
      req.write(payload.subarray(0, split));
      req.end(payload.subarray(split));
    });
    assert.equal(unicode.name, "Café 日本");
    await call("/places/unicode-test", "DELETE", {});
    const places = (await call("/places")).body;
    assert.equal(places.length, 319);
    assert.equal(places[0].geometry, undefined);
    assert.equal((await call("/docs")).body.openapi, "3.1.0");
    const practice = (
      await call("/study/next", "POST", {
        practice: true,
        placeId: "france",
        mode: "locate",
      })
    ).body;
    assert.equal(
      (
        await call("/study/check", "POST", {
          token: practice.token,
          answer: { point: [2.35, 48.85] },
        })
      ).body.correct,
      true,
    );
    await call("/study/rate", "POST", { token: practice.token, rating: 3 });
    assert.equal((await call("/stats")).body.reviews, 0);
    assert.equal((await call("/study/log")).body.total, 0);
    const practiceLog = (await call("/study/log?includePractice=true")).body;
    assert.equal(practiceLog.total, 1);
    assert.equal(practiceLog.items[0].checks[0].result.correct, true);
    assert.equal((await call("/study/log?limit=-1")).status, 400);
    assert.equal((await call("/analytics")).body.summary.reviews, 0);
    assert.equal((await call("/analytics?from=invalid")).status, 400);
    const created = await call("/places", "POST", {
      id: "test-bay",
      name: "Test bay",
      kind: "water",
      geometry: { type: "Point", coordinates: [10, 20] },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.approximate, true);
    assert.equal((await call("/cards?placeId=test-bay")).body.length, 2);
    assert.equal(
      (await call("/places/test-bay", "PATCH", { name: "Renamed bay" })).body
        .name,
      "Renamed bay",
    );
    assert.equal(
      (await call("/cards/test-bay:locate", "PATCH", { suspended: true })).body
        .suspended,
      true,
    );
    assert.equal(
      (await call("/places/test-bay", "DELETE", {})).body.archived,
      true,
    );
    assert.equal(
      (await call("/places/test-bay", "PATCH", { archived: false })).body
        .archived,
      false,
    );
    assert.equal(
      (await call("/settings", "PATCH", { newPerDay: 1, modes: ["locate"] }))
        .status,
      200,
    );
    assert.equal(
      (await call("/settings", "PATCH", { newPerDay: -1 })).status,
      400,
    );
    assert.equal(
      (
        await call(
          "/settings",
          "PATCH",
          { newPerDay: 2 },
          { Origin: "https://other.example" },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "/settings",
          "PATCH",
          { newPerDay: 2 },
          { "Content-Type": "text/plain" },
        )
      ).status,
      415,
    );
    const q = (await call("/study/next", "POST", {})).body;
    assert.equal(q.card.mode, "locate");
    assert.equal(
      (await call("/study/rate", "POST", { token: q.token, rating: 3 })).status,
      400,
    );
    await call("/study/check", "POST", {
      token: q.token,
      answer: { reveal: true },
    });
    assert.equal(
      (await call("/study/rate", "POST", { token: q.token, rating: 1 })).status,
      200,
    );
    await call("/study/rate", "POST", { token: q.token, rating: 1 });
    assert.equal((await call("/stats")).body.reviews, 1);
    assert.equal((await call("/queue")).body.counts.new, 0);
    const backup = (await call("/backup")).body;
    assert.equal(backup.format, "migs-geo");
    await call("/reviews/undo", "POST", {});
    assert.equal((await call("/stats")).body.reviews, 0);
    assert.equal((await call("/restore", "POST", backup)).status, 200);
    assert.equal((await call("/stats")).body.reviews, 1);
    const invalid = structuredClone(backup);
    invalid.reviews[0].before_card = '{"corrupt":true}';
    assert.equal((await call("/restore", "POST", invalid)).status, 400);
    assert.equal((await call("/stats")).body.reviews, 1);
    assert.ok(
      readdirSync(path.join(dir, "backups")).some((n) =>
        n.includes("before-restore"),
      ),
    );
  },
);
