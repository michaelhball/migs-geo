# Public source data

Natural Earth vectors: `nvkelso/natural-earth-vector`, revision
`ca96624a56bd078437bca8184e78163e5039ad19`, downloaded 2026-11-09.

- `ne_10m_admin_0_map_units`
- `ne_10m_geography_marine_polys`
- `ne_10m_lakes`
- `ne_10m_geography_regions_polys`
- `ne_10m_admin_0_disputed_areas`
- `ne_10m_admin_1_states_provinces`

Natural Earth data is public domain: https://www.naturalearthdata.com/about/terms-of-use/

The source downloads are ignored by Git. Use `scripts/download-geography.py` to obtain them. `scripts/prepare-geography.py` strips unused attributes, simplifies and rounds geometry, maps it to the place list, combines constituent units where needed, and identifies the two approximate markers. The prepared geometry is checked into the repository.

Oceania is a generalized study envelope enclosing Natural Earth's Australia, Melanesia, Micronesia, and Polynesia regions (including New Zealand). The definition follows the broad geographic region described by [National Geographic](https://education.nationalgeographic.org/resource/oceania-physical-geography/). The generator constructs a convex hull in Pacific-centered longitude, including intervening ocean such as the Tasman Sea, then splits it at ±180° for GeoJSON rendering and answer checking. The extent is deliberately a study convention, not an official maritime or political boundary.

Balkan Peninsula maps to the `BALKAN PEN.` / `Balkans` feature (`WIKIDATAID: Q23522`) in `ne_10m_geography_regions_polys`. This is a regional outline across country borders, separate from the `Balkan Mts.` feature. Natural Earth's [physical-region boundaries](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-physical-labels/) are generalized study outlines, not surveyed borders.

`data/notes.json` contains the 319 public place names, country notes, and tags extracted from an Ultimate Geography Extended collection. Original Anki IDs, card schedules, review history, flags, capitals, and media are not included. IDs have been replaced with independent slugs. The upstream license for non-image deck content is included here.

`data/answer-aliases.json` lists additional accepted answers for individual places, including North Cyprus, DRC, and shorter island names. The atlas generator adds these to `data/places.json`. Bare “Congo” is excluded because it does not distinguish the two countries. Existing collections can receive additions through `PATCH /api/places/:id` while preserving their current aliases and schedules.

The Browse terrain viewer uses GMT's pixel-registered 10 arc-minute SRTM15+ v2.7 relief grid (Tozer et al., 2019, https://doi.org/10.1029/2019EA000658). Download earth_relief_10m_p.grd from https://oceania.generic-mapping-tools.org/server/earth/earth_relief/ and run `gdal_translate -unscale -ot Int16 -of ENVI earth_relief_10m_p.grd relief.bin` on a little-endian host, then `gzip -nc relief.bin > public/data/relief.i16.gz`. The asset stores metres in north-to-south rows. Heights are exaggerated in the viewer to show regional relief.

English capital names, hints, notes and flag similarity notes, plus unmodified flag images, come from [Ultimate Geography](https://github.com/anki-geo/ultimate-geography/tree/46ce8fe14ec84eb39763310179f25d6ff9ca4c73). The existing East Timor card maps to the upstream Timor-Leste record. Per-image source and license details are in public/flags/sources.csv and public/flags/LICENSE.md.

US, Canadian and Australian subdivision cards and permanent interior borders use the same Natural Earth administrative polygons. Shared edges are drawn once. The US pack includes 50 states, Canada includes all 13 provinces and territories, and Australia includes its six states, the Northern Territory and the Australian Capital Territory. The generator groups [Lord Howe Island with New South Wales](https://www.lhib.nsw.gov.au/environment/world-heritage) and [Macquarie Island with Tasmania](https://parks.tas.gov.au/explore-our-parks/macquarie-island-world-heritage-area).

City packs use Natural Earth's public-domain 1:10m populated places (the same revision as the atlas). Each country offers up to ten distinct city names ranked by the source's population estimate. The ranking selects study examples and is not a current census.

The flat atlas Terrain layer uses NOAA NCEI's [ETOPO 2022 Global Relief Model](https://doi.org/10.25921/fd45-gt74). scripts/prepare-terrain-tiles.py shades the 60-arc-second surface worldwide and the 15-arc-second surface across New Zealand's main islands (S30E165, S45E165). North-up WebP tiles match Leaflet's geographic projection, with 512 source pixels per 256 CSS pixels. The separate tiltable regional model uses the GMT grid above.

The inland lake pack uses the same pinned Natural Earth lake and alkaline lake polygons and simplification as the unlabeled map. The generator groups multipart names, distinguishes homonyms, and includes named bays in their parent Great Lake outlines. It skips unnamed features without a usable group name, reservoirs, and water already covered by the original deck. Natural Earth feature IDs supply stable card identifiers. Continent filters use the enclosing or nearest continental outline.
