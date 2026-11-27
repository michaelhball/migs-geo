"""Build the offline atlas from local Ultimate Geography notes and Natural Earth.

No Anki database is modified. Source inputs are retained in data/sources.
"""
import json, math, re, unicodedata
from map_boundaries import boundaries
from lake_cards import prepare_lake_cards
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
def read(name): return json.loads((ROOT / ('data/sources/' + name + '.geojson')).read_text())['features']
def norm(s): return re.sub(r'[^a-z0-9]', '', unicodedata.normalize('NFKD', (s or '').lower().removeprefix('the ')).encode('ascii', 'ignore').decode())
def props(f): return {k.lower(): v for k, v in f.get('properties',{}).items()}
def match(fs, name, keys=('name', 'name_long', 'name_en', 'geounit')):
    for key in keys:
        found = [f for f in fs if norm(props(f).get(key)) == norm(name)]
        if found: return found
    return []
def polygons(f):
    g=f.get('geometry',f)
    return g['coordinates'] if g['type']=='MultiPolygon' else [g['coordinates']]
def geometry(fs): return {'type':'MultiPolygon', 'coordinates':[poly for f in fs for poly in polygons(f)]}
def area(r): return abs(sum(a[0]*b[1]-a[1]*b[0] for a,b in zip(r,r[1:]))/2)
def simplify(points, tolerance=.012):
    if len(points)<8:return points
    a,b=points[0],points[-1];dx,dy=b[0]-a[0],b[1]-a[1];den=dx*dx+dy*dy
    maximum,index=0,0
    for i,p in enumerate(points[1:-1],1):
        t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/den)) if den else 0
        d=(p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dy)**2
        if d>maximum:maximum,index=d,i
    if maximum>tolerance*tolerance:return simplify(points[:index+1],tolerance)[:-1]+simplify(points[index:],tolerance)
    return [a,b]
def compact(g):
    out=[]
    for poly in polygons(g):
        rings=[]
        for ring in poly:
            reduced=simplify(ring)
            if len(reduced)<4:reduced=ring
            rings.append([[round(x,5),round(y,5)] for x,y,*_ in reduced])
        out.append(rings)
    return {'type':'MultiPolygon','coordinates':out}
def subpolys(fs,box):
    x1,y1,x2,y2=box; result=[]
    for f in fs:
        for poly in polygons(f):
            ring=poly[0];x=sum(p[0] for p in ring)/len(ring);y=sum(p[1] for p in ring)/len(ring)
            if x1<x<x2 and y1<y<y2: result.append({'geometry':{'type':'Polygon','coordinates':poly}})
    return result

def pacific_extent(fs):
    """Generalized study envelope, including water between the region's islands.

    Work in 0–360 longitude so the hull crosses the Pacific, then split it at
    the date line to retain valid GeoJSON and point-in-polygon checking.
    """
    points=sorted({(x if x>=0 else x+360,y) for f in fs for poly in polygons(f) for x,y,*_ in poly[0]})
    def cross(o,a,b): return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    def half(points):
        out=[]
        for p in points:
            while len(out)>=2 and cross(out[-2],out[-1],p)<=0: out.pop()
            out.append(p)
        return out
    hull=half(points)[:-1]+half(reversed(points))[:-1]
    def clip(east):
        result=[]
        for a,b in zip(hull[-1:]+hull[:-1],hull):
            inside_a=a[0]>=180 if east else a[0]<=180
            inside_b=b[0]>=180 if east else b[0]<=180
            if inside_a!=inside_b:
                result.append((180,a[1]+(b[1]-a[1])*(180-a[0])/(b[0]-a[0])))
            if inside_b: result.append(b)
        ring=[[round(x-360 if east else x,5),round(y,5)] for x,y in result]
        return [ring+[ring[0]]]
    return {'type':'MultiPolygon','coordinates':[clip(False),clip(True)]}

land=read('map-units');marine=read('marine');lakes=read('lakes');regions=read('regions');disputed=read('disputed')
notes=json.loads((ROOT/'data/notes.json').read_text())
answer_aliases=json.loads((ROOT/'data/answer-aliases.json').read_text())
aliases={'Sahrawi Arab Democratic Republic':'Western Sahara','Gulf of California':'Golfo de California','Saint Martin':'Saint-Martin','Czech Republic':'Czechia','Balkan Peninsula':'Balkans'}
grouped={'United Kingdom':['England','Scotland','Wales','Northern Ireland'],'Belgium':['Flemish Region','Walloon Region','Brussels'],'Palestine':['Gaza','West Bank'],'Antigua and Barbuda':['Antigua','Barbuda'],'Akrotiri and Dhekelia':['Akrotiri','Dhekelia'],'Pacific Ocean':['North Pacific Ocean','South Pacific Ocean'],'Atlantic Ocean':['North Atlantic Ocean','South Atlantic Ocean'],'Aral Sea':['North Aral Sea','South Aral Sea']}
boxes={'Canary Islands':('Spain',[-19,27,-13,30]),'Hawaii':('United States of America',[-161,18,-154,23]),'Alaska':('United States of America',[-180,50,-129,73]),'Kaliningrad Oblast':('Russia',[19,54,23,56]),'Jeju':('South Korea',[126,33,127,34])}
region_names={'European Union','Scandinavia','Balkan Peninsula','Polynesia','Melanesia','Micronesia','Europe','Asia','Africa','North America','South America','Oceania','Antarctica'}
# Broad cultural regions have no single agreed boundary. These are explicit,
# approximate study extents and are self-graded, never precise auto-grading.
approx={'Polynesia':[-150,-10,3500],'Melanesia':[161,-10,2400],'Micronesia':[152,10,2400],'Scandinavia':[16,64,900], 'Bering Strait':[-168.9,65.9,100], 'Celtic Sea':[-7.5,50,280]}
deck=[]
for n in notes:
    name=n['name'];water='UG::Oceans+Seas' in n['tags'];kind='water' if water else 'region' if name in region_names else 'country' if 'UG::Sovereign_State' in n['tags'] else 'territory'
    fs=[];source='Natural Earth 1:10m';g=None;approximate=False
    if name=='Oceania':
        fs=[f for part in ['Australia','Melanesia','Micronesia','Polynesia'] for f in match(regions,part)]
        if len(fs)!=4: raise ValueError('Missing source region for Oceania')
        g=pacific_extent(fs)
        source='Generalized study extent enclosing Natural Earth Australia, Melanesia, Micronesia and Polynesia, including intervening ocean'
    elif name in grouped:
        pool=marine+lakes if water else land
        fs=[f for part in grouped[name] for f in match(pool,part)]
    elif name in boxes:
        parent,box=boxes[name];fs=subpolys(match(land,parent),box)
    elif name in ['Abkhazia','South Ossetia','Transnistria']:
        fs=match(disputed,name,('brk_name','name_en'))
    elif name=='European Union':
        member_names=[x['name'] for x in notes if 'UG::European_Union' in x['tags']]
        fs=[f for member in member_names for f in (match(land,member,('admin',)) or match(land,member))]
    elif name in ['Bosnia and Herzegovina','Iraq','Serbia','Tanzania','Somalia','Georgia']:
        fs=match(land,'Republic of Serbia' if name=='Serbia' else name,('admin',))
    else:
        pool=marine+lakes if water else regions if kind=='region' else land
        fs=match(pool,name) or match(pool,aliases.get(name,name))
        if not fs and not water:fs=match(regions,name)
    if not fs and name not in approx:fs=match(land,name) or match(regions,name)
    if fs and not g:g=compact(geometry(fs))
    if not fs and name in approx:
        lon,lat,radius=approx[name];approximate=True;g={'type':'Point','coordinates':[lon,lat]};source='Approximate study location (self-graded)'
    if not g:raise ValueError('Unmapped: '+name)
    if g['type']=='Point': center=g['coordinates'];size=0
    else:
        ring=max(g['coordinates'],key=lambda p:area(p[0]))[0]
        center=[(min(p[0] for p in ring)+max(p[0] for p in ring))/2,(min(p[1] for p in ring)+max(p[1] for p in ring))/2]
        size=sum(area(poly[0]) for poly in g['coordinates'])
        label=props(fs[0])
        if label.get('label_x') is not None and len(fs)==1:center=[label['label_x'],label['label_y']]
    alias=[aliases[name]] if name in aliases else []
    alias+= {'United States of America':['United States','USA','US'],'United Kingdom':['UK','Britain'],'Turkey':['Türkiye'],'Czech Republic':['Czechia'],'Ivory Coast':["Côte d’Ivoire","Cote d'Ivoire"],'Cape Verde':['Cabo Verde'],'East Timor':['Timor-Leste'],'Federated States of Micronesia':['Micronesia'],'Sahrawi Arab Democratic Republic':['Western Sahara'],'The Bahamas':['Bahamas'],'The Gambia':['Gambia'],'Russia':['Russian Federation']}.get(name,[])
    alias+=answer_aliases.get(n['id'],[])
    if name in ('Aral Sea', 'Dead Sea', 'Caspian Sea', 'Sea of Galilee'):
        kind = 'lake'
    deck.append({**n,'kind':kind,'geometry':g,'center':center,'approximate':approximate,'source':source,'small':not water and size<.2,'aliases':alias,'region':next((t[4:].replace('_',' ') for t in n['tags'] if t in ['UG::Europe','UG::Asia','UG::Africa','UG::North_America','UG::South_America','UG::Oceania']), 'World')})
# Conventional study outline. NOAA notes that the region has no official boundary.
deck.append({
    'id':'bermuda-triangle', 'name':'Bermuda Triangle', 'kind':'water', 'region':'North America',
    'geometry':{'type':'Polygon','coordinates':[[[-80.19,25.76],[-66.11,18.47],[-64.75,32.30],[-80.19,25.76]]]},
    'center':[-70.35,25.51], 'aliases':["Devil's Triangle"], 'tags':[],
    'info':'The study outline joins Miami, San Juan and Bermuda. The region has no official boundary.',
    'source':'Conventional study extent; NOAA National Ocean Service', 'small':False, 'approximate':False,
})
# Join the two mainland coastlines before simplification so the country border
# never becomes part of the island outline. Offshore islands have separate rings.
edges = set()
for country in ['Haiti', 'Dominican Republic']:
    unit, = match(land, country)
    mainland = max(polygons(unit), key=lambda poly: area(poly[0]))[0]
    edges.update((tuple(a), tuple(b)) for a, b in zip(mainland, mainland[1:]) if a != b)
coast = {a:b for a,b in edges if (b,a) not in edges}
ring = [min(coast)]
while ring[-1] in coast:
    ring.append(coast.pop(ring[-1]))
if coast or ring[0] != ring[-1]:
    raise ValueError('Could not assemble the Hispaniola coastline')
deck.append({
    'id':'hispaniola', 'name':'Hispaniola', 'kind':'territory', 'region':'North America',
    'geometry':compact({'type':'Polygon','coordinates':[ring]}), 'center':[-71.2,18.9],
    'aliases':['La Española','Island of Hispaniola'], 'tags':['Caribbean'],
    'info':'Haiti occupies the western part of the island and the Dominican Republic the eastern part.',
    'source':'Natural Earth 1:10m', 'small':False, 'approximate':False,
})
base={'type':'FeatureCollection','features':[{'type':'Feature','properties':{'name':props(f).get('name_long') or props(f).get('name')},'geometry':compact(f['geometry'])} for f in land]}
base['boundaries'] = boundaries(land, simplify)
us_units = [f for f in read('us-states') if props(f)['adm0_a3'] == 'USA']
# Use only shared interior edges. The atlas already draws coasts and national borders.
us_group, = boundaries(us_units, lambda line: line, country_key='adm0_a3')
base['usStateBorders'] = us_group['inner']
states = []
for f in us_units:
    p = props(f)
    if p['type_en'] != 'State':
        continue
    code, name = p['postal'], p['name_en']
    place_id = name.lower() if code in ('AK', 'HI') else 'us-state-' + code.lower()
    # Round identically to the border layer, preserving shared river bends.
    state_geometry = {'type':'MultiPolygon', 'coordinates':[
        [[[round(x,5), round(y,5)] for x,y in ring] for ring in polygon]
        for polygon in polygons(f)
    ]}
    states.append({'id':place_id, 'name':name, 'kind':'usState', 'region':'North America',
        'countryCode':'US', 'aliases':[], 'tags':[], 'info':'', 'source':'Natural Earth 1:10m',
        'geometry':state_geometry, 'center':[p['longitude'],p['latitude']], 'approximate':False, 'small':False})
if len(states) != 50 or len({s['id'] for s in states}) != 50 or not base['usStateBorders']:
    raise ValueError('Expected all 50 US states and their shared boundaries')
(ROOT/'server/us-states.json').write_text(json.dumps(sorted(states,key=lambda s:s['name']),separators=(',',':')))

# Keep studied shorelines visible at every scale, at their actual map size.
lake_bands = {}
for lake in lakes:
    attrs = props(lake)
    if attrs['featurecla'] not in ('Lake', 'Alkaline Lake'):
        continue
    studied = attrs['name'] in ('North Aral Sea', 'South Aral Sea', 'Dead Sea', 'Sea of Galilee')
    zoom = 0 if studied else attrs['min_zoom']
    lake_bands.setdefault(zoom, []).extend(compact(lake['geometry'])['coordinates'])
base['lakes'] = [
    {'minZoom': zoom, 'geometry': {'type': 'MultiPolygon', 'coordinates': polygons}}
    for zoom, polygons in sorted(lake_bands.items())
]
(ROOT/'public/data/world.json').write_text(json.dumps(base,separators=(',',':')))
(ROOT/'data/places.json').write_text(json.dumps(deck,ensure_ascii=False,separators=(',',':')))
lake_cards = prepare_lake_cards(lakes, regions, compact, deck)
(ROOT/'server/lake-places.json').write_text(json.dumps(lake_cards,ensure_ascii=False,separators=(',',':')))
print('Prepared',len(lake_cards),'named lake places')
print('Prepared',len(deck),'places;',sum(x['approximate'] for x in deck),'approximate locations')
print('Approximate:',[x['name'] for x in deck if x['approximate']])
