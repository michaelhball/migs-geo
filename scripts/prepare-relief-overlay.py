"""Render the bundled GMT elevation grid as a Leaflet overlay (NumPy, Pillow)."""
import gzip
from pathlib import Path
import numpy as np
from PIL import Image

data = Path(__file__).resolve().parents[1] / "public" / "data"
with gzip.open(data / "relief.i16.gz") as source:
    height = np.frombuffer(source.read(), dtype="<i2").reshape(1080, 2160).astype(float)

# Oblique northwest illumination, corrected for the narrowing of longitude cells.
cos_lat = np.cos(np.deg2rad(90 - (np.arange(1080) + .5) / 6))[:, None]
dy = np.gradient(height, axis=0)
dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) / 2
shade = np.clip((dx / np.maximum(cos_lat, .18) + dy) / 1100, -.50, .50)
levels = [0, 300, 1000, 2300, 4000, 6000]
palette = np.array([[157,178,137],[167,184,146],[190,179,139],
                    [180,151,116],[175,161,150],[242,239,228]])
rgba = np.empty((*height.shape, 4), dtype=np.uint8)
for channel in range(3):
    rgba[:,:,channel] = np.clip(np.interp(height, levels, palette[:,channel]) * (1 + shade), 0, 255)
rgba[:,:,3] = np.where(height > 0, 160, 0)
Image.fromarray(rgba).save(data / "relief-overlay.png", optimize=True)
