// Spherical surface area of a GeoJSON polygon. Holes are subtracted from
// their exterior ring; longitude differences are wrapped at the date line.
const radiusKm = 6371.0088;
const rad = Math.PI / 180;
const cache = new WeakMap();
function ringArea(ring) {
  let sum = 0;
  for (let i=1;i<ring.length;i++) {
    const [x1,y1]=ring[i-1], [x2,y2]=ring[i];
    const dx = ((x2-x1+540)%360-180)*rad;
    sum += dx * (Math.sin(y1*rad)+Math.sin(y2*rad));
  }
  return Math.abs(sum)*radiusKm**2/2;
}
export function areaKm2(geometry) {
  if(cache.has(geometry))return cache.get(geometry);
  const polygons = geometry.type==="MultiPolygon" ? geometry.coordinates :
    geometry.type==="Polygon" ? [geometry.coordinates] : [];
  const area = polygons.reduce((total,[outer,...holes]) =>
    total + ringArea(outer) - holes.reduce((s,h)=>s+ringArea(h),0),0);
  cache.set(geometry,area);
  return area;
}
