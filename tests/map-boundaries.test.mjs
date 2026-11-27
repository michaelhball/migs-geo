import assert from "node:assert/strict";
import test from "node:test";
import world from "../public/data/world.json" with { type: "json" };
import places from "../data/places.json" with { type: "json" };
import { indexCountryBoundaries } from "../src/mapBoundaries.ts";

test("whole-country outlines follow the card geometry and preserve separately studied borders", () => {
  const lookup = indexCountryBoundaries(world);
  const polygons = id => places.find(place => place.id === id).geometry.coordinates;
  for (const [id, members] of [
    ["somalia", ["Puntland", "Somalia"]],
    ["serbia", ["Vojvodina", "Serbia"]],
    ["bosnia-and-herzegovina", ["Federation of Bosnia and Herzegovina", "Republic Srpska", "Brcko District"]],
  ]) {
    const boundary = lookup(polygons(id));
    assert.deepEqual(boundary.members.map(i => world.features[i].properties.name), members);
    assert.ok(boundary.inner.length && boundary.outer.length);
    assert.equal(lookup([polygons(id)[0]]), undefined);
  }
  for (const id of ["kosovo", "somaliland"]) assert.equal(lookup(polygons(id)), undefined);
});

test("the base lake layer includes the complete study shorelines at world zoom", () => {
  const rings = new Set(world.lakes.filter(b => b.minZoom === 0)
    .flatMap(b => b.geometry.coordinates).map(poly => JSON.stringify(poly)));
  for (const id of ["aral-sea", "dead-sea", "sea-of-galilee"]) {
    const place = places.find(p => p.id === id);
    for (const polygon of place.geometry.coordinates) assert.ok(rings.has(JSON.stringify(polygon)), id);
  }
});

test("the atlas shows interior US borders along the state card polygons", async () => {
  const {default: states} = await import("../server/us-states.json", {with:{type:"json"}});
  const vertices = new Set(world.usStateBorders.flat().map(p => p.join(",")));
  assert.equal(states.length, 50);
  for (const state of states.filter(p => !["alaska","hawaii"].includes(p.id))) {
    assert.ok(state.geometry.coordinates.some(poly => poly[0].some(p => vertices.has(p.join(",")))), state.name);
  }
  const edgeKey = (a,b) => [a.join(","),b.join(",")].sort().join("/");
  const edges = new Set();
  for (const line of world.usStateBorders) {
    for (let i = 1; i < line.length; i++) {
      const key = edgeKey(line[i-1], line[i]);
      assert.ok(!edges.has(key), "draw each shared edge once");
      edges.add(key);
    }
  }
});
