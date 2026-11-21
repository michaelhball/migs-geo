import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {countryFrame} from "../src/countryFrame.ts";
const places = JSON.parse(readFileSync(new URL("../data/places.json",import.meta.url)));
test("frame major islands together, including across the date line", () => {
  for (const [id,points] of Object.entries({
    "new-zealand":[[174.76,-36.85],[168.35,-46.41]],
    japan:[[141.35,43.06],[130.4,33.59]],
    indonesia:[[95.32,5.55],[140.72,-2.53]],
    philippines:[[120.98,14.60],[125.61,7.07]],
    fiji:[[178.44,-18.14],[-179.9,-16.8]],
    france:[[2.35,48.86],[8.74,41.92]],
  })) {
    const g=places.find(p=>p.id===id).geometry;
    const b=countryFrame(g.coordinates.map(p=>p[0]));
    for(const [lon,lat] of points) {
      const x=lon+360*Math.round(((b.east+b.west)/2-lon)/360);
      assert.ok(x>=b.west && x<=b.east && lat>=b.south && lat<=b.north,id);
    }
    assert.ok(b.east-b.west < 60,id);
  }
});
