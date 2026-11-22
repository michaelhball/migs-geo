export type CountryBoundary = {
  members: number[];
  outer: number[][][];
  inner: number[][][];
};

type Polygon = number[][][];
type World = {
  features: { geometry: { coordinates: Polygon[] } }[];
  boundaries: CountryBoundary[];
};

// Recognize a whole country by its actual polygon data. A custom shape or a
// card for one constituent unit keeps its own outline, even with the same name.
export function indexCountryBoundaries(world: World) {
  const candidates = world.boundaries.map(boundary => {
    const polygons = boundary.members.flatMap(index => world.features[index].geometry.coordinates);
    return { boundary, count: polygons.length, rings: new Set(polygons.map(p => JSON.stringify(p))) };
  });
  return (polygons: Polygon[]) => {
    const byCount = candidates.filter(candidate => candidate.count === polygons.length);
    if (!byCount.length) return undefined;
    const rings = new Set(polygons.map(p => JSON.stringify(p)));
    return byCount.find(candidate => candidate.rings.size === rings.size &&
      [...rings].every(ring => candidate.rings.has(ring)))?.boundary;
  };
}
