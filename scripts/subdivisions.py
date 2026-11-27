"""Build the study polygons and shared interior borders from one Natural Earth layer."""
from collections import defaultdict
from map_boundaries import boundaries

PACKS = {
    'USA': ('us-states', 'usState', 'North America', 'us-state-', 50),
    'CAN': ('canada-provinces', 'canadaProvince', 'North America', 'ca-province-', 13),
    'AUS': ('australia-states', 'australiaState', 'Oceania', 'au-state-', 8),
}


def prepare_subdivisions(features):
    borders, packs = {}, {}
    for country, (filename, kind, region, prefix, count) in PACKS.items():
        units = [f for f in features if f['properties']['adm0_a3'] == country]
        group, = boundaries(units, lambda line: line, country_key='adm0_a3')
        borders[country] = group['inner']
        parts = defaultdict(list)
        places = {}
        for f in units:
            p = f['properties']
            if country == 'USA' and p['type_en'] != 'State':
                continue
            code = p['iso_3166_2'].split('-')[-1]
            # Natural Earth lists these offshore parts separately from their states.
            if country == 'AUS' and p['name'] == 'Macquarie Island':
                code = 'TAS'
            if country == 'AUS' and code not in ('NSW','QLD','SA','TAS','VIC','WA','ACT','NT'):
                continue
            g = f['geometry']
            polygons = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
            parts[code].extend([[[round(x,5),round(y,5)] for x,y in ring] for ring in polygon]
                               for polygon in polygons)
            if country == 'AUS' and p['name'] in ('Lord Howe Island','Macquarie Island'):
                continue
            name = p['name_en']
            place_id = name.lower() if country == 'USA' and code in ('AK','HI') else prefix + code.lower()
            places[code] = {'id':place_id, 'name':name, 'kind':kind, 'region':region,
                            'countryCode':p['iso_a2'], 'aliases':[], 'tags':[], 'info':'',
                            'source':'Natural Earth 1:10m', 'geometry':{'type':'MultiPolygon','coordinates':parts[code]},
                            'center':[p['longitude'],p['latitude']], 'approximate':False, 'small':False}
        if len(places) != count or set(places) != set(parts) or not borders[country]:
            raise ValueError(f'Incomplete subdivision data for {country}')
        packs[filename] = sorted(places.values(), key=lambda s:s['name'])
    return borders, packs
