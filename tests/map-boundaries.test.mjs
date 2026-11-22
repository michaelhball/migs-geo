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
