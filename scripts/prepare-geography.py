"""Build the offline atlas from local Ultimate Geography notes and Natural Earth.

No Anki database is modified. Source inputs are retained in data/sources.
"""
import json, math, re, unicodedata
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

land=read('map-units');marine=read('marine');lakes=read('lakes');regions=read('regions');disputed=read('disputed')
notes=json.loads((ROOT/'data/notes.json').read_text())
answer_aliases=json.loads((ROOT/'data/answer-aliases.json').read_text())
aliases={'Sahrawi Arab Democratic Republic':'Western Sahara','Gulf of California':'Golfo de California','Saint Martin':'Saint-Martin','Czech Republic':'Czechia','Balkan Peninsula':'Balkans'}
grouped={'United Kingdom':['England','Scotland','Wales','Northern Ireland'],'Belgium':['Flemish Region','Walloon Region','Brussels'],'Palestine':['Gaza','West Bank'],'Antigua and Barbuda':['Antigua','Barbuda'],'Akrotiri and Dhekelia':['Akrotiri','Dhekelia'],'Pacific Ocean':['North Pacific Ocean','South Pacific Ocean'],'Atlantic Ocean':['North Atlantic Ocean','South Atlantic Ocean'],'Aral Sea':['North Aral Sea','South Aral Sea']}
boxes={'Canary Islands':('Spain',[-19,27,-13,30]),'Hawaii':('United States of America',[-161,18,-154,23]),'Alaska':('United States of America',[-180,50,-129,73]),'Kaliningrad Oblast':('Russia',[19,54,23,56]),'Jeju':('South Korea',[126,33,127,34])}
region_names={'European Union','Scandinavia','Balkan Peninsula','Polynesia','Melanesia','Micronesia','Europe','Asia','Africa','North America','South America','Oceania','Antarctica'}
# Broad cultural regions have no single agreed boundary. These are explicit,
# approximate study extents and are self-graded, never precise auto-grading.
approx={'Polynesia':[-150,-10,3500],'Melanesia':[161,-10,2400],'Micronesia':[152,10,2400],'Scandinavia':[16,64,900],'Oceania':[155,-18,6000], 'Bering Strait':[-168.9,65.9,100], 'Celtic Sea':[-7.5,50,280]}
deck=[]
for n in notes:
    name=n['name'];water='UG::Oceans+Seas' in n['tags'];kind='water' if water else 'region' if name in region_names else 'country' if 'UG::Sovereign_State' in n['tags'] else 'territory'
    fs=[];source='Natural Earth 1:10m';g=None;approximate=False
    if name in grouped:
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
    if fs:g=compact(geometry(fs))
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
    deck.append({**n,'kind':kind,'geometry':g,'center':center,'approximate':approximate,'source':source,'small':not water and size<.2,'aliases':alias,'region':next((t[4:].replace('_',' ') for t in n['tags'] if t in ['UG::Europe','UG::Asia','UG::Africa','UG::North_America','UG::South_America','UG::Oceania']), 'World')})
base={'type':'FeatureCollection','features':[{'type':'Feature','properties':{'name':props(f).get('name_long') or props(f).get('name')},'geometry':compact(f['geometry'])} for f in land]}
(ROOT/'public/data/world.json').write_text(json.dumps(base,separators=(',',':')))
(ROOT/'data/places.json').write_text(json.dumps(deck,ensure_ascii=False,separators=(',',':')))
print('Prepared',len(deck),'places;',sum(x['approximate'] for x in deck),'approximate locations')
print('Approximate:',[x['name'] for x in deck if x['approximate']])
