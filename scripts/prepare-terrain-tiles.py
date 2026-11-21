"""Prepare the offline EPSG:4326 relief pyramid from NOAA ETOPO 2022 GeoTIFFs.
Usage: python prepare-terrain-tiles.py GLOBAL_60s.tif NZ_15s.vrt
Requires rasterio, NumPy and Pillow. Tile coordinates match Leaflet EPSG:4326.
"""
from pathlib import Path
import math, sys
import numpy as np
from PIL import Image
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import from_bounds

root = Path(__file__).resolve().parents[1] / "public/data/terrain"
size = 512
palette = np.array([[166,187,151], [183,192,157], [189,177,139],
                    [170,148,119], [180,165,149], [235,234,222]])
levels = [0,450,1400,2800,4200,5700]

def render(source, family, zooms, extent):
    with rasterio.open(source) as src:
        for z in zooms:
            span = 180 / 2**z
            step = span / size
            west,south,east,north = extent
            for x in range(math.floor((west+180)/span), math.ceil((east+180)/span)):
                for y in range(math.floor((90-north)/span), math.ceil((90-south)/span)):
                    left,top = x*span-180,90-y*span
                    win = from_bounds(left-step,top-span-step,left+span+step,top+step,src.transform)
                    h = src.read(1,window=win,out_shape=(size+2,size+2),
                                 boundless=True,fill_value=-99999,resampling=Resampling.bilinear).astype('float32')
                    lat = top-(np.arange(size+2)-.5)*step
                    dx = np.gradient(h,axis=1)/(111000*step*np.maximum(.08,np.cos(np.radians(lat)))[:,None])
                    dy = np.gradient(h,axis=0)/(111000*step)
                    gain = min(17,max(2,step*400))
                    shade = np.clip((dx+dy)*gain,-.47,.39)[1:-1,1:-1]
                    h = h[1:-1,1:-1]
                    rgba = np.zeros((size,size,4),dtype=np.uint8)
                    for c in range(3):
                        rgba[:,:,c] = np.clip(np.interp(h,levels,palette[:,c])*(1+shade),0,255)
                    rgba[:,:,3] = np.where(h>0,200,0)
                    file=root/family/str(z)/str(x)/f"{y}.webp"
                    file.parent.mkdir(parents=True,exist_ok=True)
                    Image.fromarray(rgba).save(file,quality=86,method=2)
            print(f"{family} zoom {z}",flush=True)
if __name__ == "__main__":
    render(sys.argv[1],"world",range(5),(-180,-90,180,90))
    render(sys.argv[2],"nz",(5,6),(165,-48,179,-33))
