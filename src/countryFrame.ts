// Fit connected groups of islands in one longitude window. The largest landmass
// anchors the view so a distant dependency need not shrink the mainland.
export function countryFrame(rings: number[][][]) {
  const boxes = rings.map(ring => {
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity, area = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x,y] = ring[i], [nx,ny] = ring[(i+1) % ring.length];
      west = Math.min(west,x); east = Math.max(east,x);
      south = Math.min(south,y); north = Math.max(north,y);
      area += x*ny - nx*y;
    }
    return {west,east,south,north,area:Math.abs(area)};
  }).sort((a,b) => b.area-a.area);
  const bounds = {...boxes[0]};
  const anchor = (bounds.west + bounds.east)/2;
  const gap = Math.max(2, Math.min(12, Math.max(bounds.east-bounds.west,bounds.north-bounds.south)*0.65));
  const pending = boxes.slice(1).filter(b => b.area >= bounds.area * 0.003).map(b => {
    const shift = 360*Math.round((anchor-(b.west+b.east)/2)/360);
    return {...b, west:b.west+shift, east:b.east+shift};
  });
  let changed;
  do {
    changed = false;
    for (let i=pending.length-1; i>=0; i--) {
      const b=pending[i];
      if (b.east < bounds.west-gap || b.west > bounds.east+gap ||
          b.north < bounds.south-gap || b.south > bounds.north+gap) continue;
      bounds.east=Math.max(bounds.east,b.east); bounds.west=Math.min(bounds.west,b.west);
      bounds.north=Math.max(bounds.north,b.north); bounds.south=Math.min(bounds.south,b.south);
      pending.splice(i,1); changed=true;
    }
  } while (changed);
  return bounds;
}
