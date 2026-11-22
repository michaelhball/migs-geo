// A country hint for browsing, based on sampled shoreline vertices in the atlas.
import {readFileSync,writeFileSync} from "node:fs";
import {booleanPointInPolygon} from "@turf/boolean-point-in-polygon";
import lakes from "../server/lake-places.json" with {type:"json"};
import places from "../data/places.json" with {type:"json"};
const units=JSON.parse(readFileSync(new URL("../data/sources/map-units.geojson",import.meta.url))).features;
const polygons=units.flatMap(f=>(f.geometry.type==="Polygon"?[f.geometry.coordinates]:f.geometry.coordinates).map(coordinates=>{
  const xs=coordinates[0].map(p=>p[0]), ys=coordinates[0].map(p=>p[1]);
  return {name:f.properties.ADMIN,geom:{type:"Polygon",coordinates},box:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]};
}));
const locations={};
for(const lake of [...lakes,...places.filter(p=>p.kind==="lake")]){
  const names=new Set();
  for(const [ring] of lake.geometry.coordinates){
    for(let i=0;i<ring.length;i+=Math.max(1,Math.floor(ring.length/80))){
      const [x,y]=ring[i];
      for(const {box:[w,s,e,n],name,geom} of polygons){
        if(x>=w&&x<=e&&y>=s&&y<=n&&booleanPointInPolygon([x,y],geom))names.add(name);
      }
    }
  }
  locations[lake.id]=[...names].sort();
}
writeFileSync(new URL("../server/lake-locations.json",import.meta.url),JSON.stringify(locations)+"\n");
