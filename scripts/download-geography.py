"""Download the public source geometry required only to regenerate the atlas."""
from pathlib import Path
from urllib.request import urlretrieve
root=Path(__file__).resolve().parents[1]/'data/sources'
root.mkdir(parents=True,exist_ok=True)
layers={'map-units':'ne_10m_admin_0_map_units','marine':'ne_10m_geography_marine_polys','lakes':'ne_10m_lakes','regions':'ne_10m_geography_regions_polys','disputed':'ne_10m_admin_0_disputed_areas'}
for name,layer in layers.items():
    target=root/(name+'.geojson')
    if target.exists():continue
    print('Downloading',layer)
    urlretrieve('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'+layer+'.geojson',target)
print('Done. Run python3 scripts/prepare-geography.py to rebuild the bundled atlas.')
