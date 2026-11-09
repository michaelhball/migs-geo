import L from "leaflet";

type Coordinates = L.LatLng[] | Coordinates[];
const levels = [3, 5, 7];
const cache = new WeakMap<object, Coordinates[]>();

function simplify(coordinates: Coordinates, tolerance: number): Coordinates {
  if (Array.isArray(coordinates[0])) {
    return (coordinates as Coordinates[]).map((ring) =>
      simplify(ring, tolerance),
    );
  }
  const ring = coordinates as L.LatLng[];
  const reduced = L.LineUtil.simplify(
    ring.map((p) => L.point(p.lng, p.lat)),
    tolerance,
  );
  // Keep small islands and holes even when they are smaller than a pixel.
  return reduced.length < 3 ? ring : reduced.map((p) => L.latLng(p.y, p.x));
}

export function worldDetail(map: L.Map, layer: L.Polygon, feature: object) {
  let variants = cache.get(feature);
  if (!variants) {
    const original = layer.getLatLngs() as Coordinates;
    // EPSG:4326 uses 256 * 2^zoom / 180 pixels per degree. Limit coastline
    // simplification to 0.75 CSS pixels at each tier's closest zoom level.
    variants = levels.map((zoom) =>
      simplify(original, (0.75 * 180) / (256 * 2 ** zoom)),
    );
    variants.push(original);
    cache.set(feature, variants);
  }
  let current = -1;
  const update = () => {
    const found = levels.findIndex((level) => map.getZoom() <= level);
    const next = found < 0 ? levels.length : found;
    if (next !== current) {
      layer.setLatLngs(variants[next] as L.LatLng[][][]);
      current = next;
    }
  };
  update();
  return update;
}
