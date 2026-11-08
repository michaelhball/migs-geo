#!/usr/bin/env node
import { readFileSync } from 'node:fs';
const [method='GET',route='/api/stats',input]=process.argv.slice(2);
if(method==='--help'){console.log('Usage: node scripts/geo.mjs METHOD /api/path [JSON | @file.json]\nExamples:\n  node scripts/geo.mjs GET /api/stats\n  node scripts/geo.mjs PATCH /api/settings \'{"newPerDay":20}\'\n  node scripts/geo.mjs POST /api/places @new-place.json\nAPI reference: GET /api/docs and API.md');process.exit(0);}
try{const response=await fetch(`${process.env.GEO_URL||'http://127.0.0.1:4387'}${route}`,{method,headers:{'Content-Type':'application/json'},...(['POST','PATCH','PUT','DELETE'].includes(method)?{body:input?(input.startsWith('@')?readFileSync(input.slice(1),'utf8'):input):'{}'}:{})});const result=await response.json();console.log(JSON.stringify(result,null,2));if(!response.ok)process.exitCode=1;}catch(e){console.error(e.message+' — start the app with npm start.');process.exitCode=1;}
