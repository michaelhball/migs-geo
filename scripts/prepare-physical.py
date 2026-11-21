"""Build optional study features from Natural Earth regions (10m) and rivers (50m).
Pass the two Natural Earth GeoJSON files as arguments. Multiple named reaches
of one river are kept as separate lines rather than connected across gaps.
"""
import json, re, sys, unicodedata
from pathlib import Path

regions, rivers = [json.loads(Path(f).read_text())["features"] for f in sys.argv[1:]]
out = []

def add(kind, name, region, geometry, aliases=()):
    slug = unicodedata.normalize("NFKD",name).encode("ascii","ignore").decode().lower()
    point = geometry["coordinates"]
    while isinstance(point[0],list):
        point = point[0]
    out.append(dict(id=kind+"-"+re.sub("[^a-z0-9]+","-",slug).strip("-"), name=name,
        region=region, kind=kind, geometry=geometry, center=point, aliases=list(aliases),
        tags=[], info="", source="Natural Earth", archived=False, approximate=False, small=False))

groups = {
    "Africa":"Nile|White Nile|Blue Nile=Abay|Congo=Lualaba|Niger|Zambezi|Orange|Limpopo|Senegal",
    "Asia":"Yangtze=Tongtian|Yellow River=Yellow,Huang|Mekong|Ganges|Indus|Brahmaputra=Dihang|Irrawaddy=Ayeyarwady|Amur|Lena|Ob|Irtysh=Ertis|Euphrates=Al Furat,Firat|Tigris",
    "Europe":"Danube|Rhine|Volga|Seine|Thames|Elbe|Po|Dnieper|Don",
    "North America":"Mississippi|Missouri|Ohio|Columbia|Mackenzie|Yukon|St. Lawrence|Rio Grande|Colorado",
    "South America":"Amazon=Amazonas|Paraná|Orinoco|Madeira|São Francisco",
    "Oceania":"Murray|Darling",
}
for region, entries in groups.items():
    for entry in entries.split("|"):
        name, _, other = entry.partition("=")
        names = {name,*other.split(",")} - {""}
        lines=[]
        for f in rivers:
            p=f["properties"]
            if p["name_en"] not in names: continue
            for line in f["geometry"]["coordinates"]:
                lon,lat=line[0]
                if region=="North America" and not (-170<lon<-45 and lat>19):continue
                if region=="Europe" and name=="Don" and not (35<lon<48):continue
                lines.append(line)
        if lines:add("river",name,region,dict(type="MultiLineString",coordinates=lines))

ranges = """Alps|Andes|Himalayas|Rocky Mountains|Pyrenees|Ural Mountains|Appalachian Mountains|Alaska Range|Cascade Range|Brooks Range|Sierra Madre Oriental|Sierra Madre Occidental|Atlas Mountains|Drakensberg|Rwenzori Mountains|Ethiopian Highlands|Carpathian Mountains|Scandinavian Mountains|Caucasus Mountains|Balkan Mountains|Dinaric Alps|Hindu Kush|Karakoram|Tian Shan|Altai Mountains|Kunlun Mountains|Western Ghats|Eastern Ghats|Zagros Mountains|Great Dividing Range|Southern Alps/Kā Tiritiri o te Moana|Australian Alps|Transantarctic Mountains|Ellsworth Mountains|Cordillera Blanca|Serra do Mar""".split("|")
deserts = """Sahara|Gobi Desert|Kalahari Desert|Namib|Atacama Desert|Sonoran Desert|Chihuahuan Desert|Thar Desert|Taklamakan|Great Victoria Desert|Great Sandy Desert|Gibson Desert|Simpson Desert|Tanami Desert|Syrian Desert|Karakum Desert|Dasht-e Kavir|Dasht-e Lut|Rub' al Khali|Nubian Desert|Libyan Desert|Danakil Desert|Registan Desert|Kyzyl Kum""".split("|")
for kind,names in [("range",ranges),("desert",deserts)]:
    for name in names:
        fs=[f for f in regions if f["properties"]["NAME_EN"]==name]
        assert fs,name
        polygons=[]
        for f in fs:
            g=f["geometry"]
            polygons.extend(g["coordinates"] if g["type"]=="MultiPolygon" else [g["coordinates"]])
        add(kind,name,fs[0]["properties"]["REGION"],dict(type="MultiPolygon",coordinates=polygons),
            ["Southern Alps"] if name.startswith("Southern Alps/") else [])
Path(__file__).resolve().parents[1].joinpath("server/physical-places.json").write_text(json.dumps(out,separators=(",",":")))
