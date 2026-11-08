import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// All resources belong to this test run. It never mounts a user's data directory
// or binds a host port, so an existing local Migs Geo server can keep running.
const image = process.argv[2] || "migs-geo:ci";
const name = `migs-geo-test-${process.pid}-${Date.now()}`;
const volume = `${name}-data`;
const docker = (args, options = {}) =>
  execFileSync("docker", args, { encoding: "utf8", ...options })?.trim() || "";
async function healthy() {
  for (let i = 0; i < 60; i++) {
    const state = docker([
      "inspect",
      "--format",
      "{{.State.Health.Status}}",
      name,
    ]);
    if (state === "healthy") return;
    if (state === "unhealthy") throw Error("Container health check failed.");
    await delay(500);
  }
  throw Error("Container did not become healthy within 30 seconds.");
}
const apiHelpers = `
  import assert from 'node:assert/strict';
  import { DatabaseSync } from 'node:sqlite';
  import { readdirSync } from 'node:fs';
  const base='http://127.0.0.1:4387';
  async function api(route,method='GET',body){
    const r=await fetch(base+'/api'+route,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const data=await r.json();assert.equal(r.ok,true,JSON.stringify(data));return data;
  }
  assert.notEqual(process.getuid(),0,'The production container should not run as root.');
  const health=await api('/health');assert.equal(health.database,'ok');assert.equal(health.schemaVersion,1);
`;
const run = (source, environment = []) =>
  docker(
    [
      "exec",
      "-i",
      ...environment.flatMap((e) => ["-e", e]),
      name,
      "node",
      "--input-type=module",
    ],
    { input: apiHelpers + source },
  );
try {
  docker(["compose", "config", "--quiet"]);
  docker(["volume", "create", volume]);
  docker([
    "run",
    "--detach",
    "--name",
    name,
    "--mount",
    `type=volume,source=${volume},target=/data`,
    image,
  ]);
  await healthy();
  console.log(
    "Container is healthy; checking the production build and initial SQLite setup.",
  );
  const saved = JSON.parse(
    run(`
    const page=await fetch(base);assert.equal(page.status,200);const html=await page.text();assert.match(html,/id="root"/);
    const asset=html.match(/src="([^\"]+\\.js)"/);assert.ok(asset);assert.equal((await fetch(base+asset[1])).status,200);
    const world=await (await fetch(base+'/data/world.json')).json();assert.ok(world.features.length>250);
    assert.equal((await api('/places')).length,319);assert.equal((await api('/cards')).length,638);
    await api('/settings','PATCH',{newPerDay:7});
    await api('/places','POST',{id:'container-test',name:'Container test point',geometry:{type:'Point',coordinates:[10,20]}});
    const question=await api('/study/next','POST',{});await api('/study/check','POST',{token:question.token,answer:{reveal:true}});
    const result=await api('/study/rate','POST',{token:question.token,rating:1});
    console.log(JSON.stringify({id:result.card.id,memory:result.card.memory}));
  `),
  );
  assert.ok(saved.id);
  docker(["restart", "--time", "10", name]);
  await healthy();
  console.log(
    "Container restarted; checking saved settings, collection, reviews, and backups.",
  );
  run(
    `
    const saved=JSON.parse(process.env.EXPECTED);
    assert.equal((await api('/settings')).newPerDay,7);
    assert.equal((await api('/places')).length,320);
    assert.equal((await api('/stats')).reviews,1);
    assert.deepEqual((await api('/cards/'+saved.id)).memory,saved.memory);
    const backup=await api('/backup');await api('/settings','PATCH',{newPerDay:12});await api('/restore','POST',backup);
    assert.equal((await api('/settings')).newPerDay,7);assert.equal((await api('/stats')).reviews,1);
    assert.ok(readdirSync('/data/backups').some(n=>n.includes('before-restore')));
    const db=new DatabaseSync('/data/geography.sqlite',{readOnly:true});
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);db.close();
  `,
    [`EXPECTED=${JSON.stringify(saved)}`],
  );
  console.log(
    "Container checks passed. SQLite state survives restarts and backup/restore.",
  );
} catch (error) {
  try {
    console.error(docker(["logs", name]));
  } catch {}
  throw error;
} finally {
  // Only this run's explicitly named disposable resources are removed.
  try {
    docker(["rm", "--force", name], { stdio: "ignore" });
  } catch {}
  try {
    docker(["volume", "rm", volume], { stdio: "ignore" });
  } catch {}
}
