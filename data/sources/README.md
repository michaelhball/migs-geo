# Public source data

Natural Earth vectors: `nvkelso/natural-earth-vector`, revision
`ca96624a56bd078437bca8184e78163e5039ad19`, downloaded 2026-11-09.

- `ne_10m_admin_0_map_units`
- `ne_10m_geography_marine_polys`
- `ne_10m_lakes`
- `ne_10m_geography_regions_polys`
- `ne_10m_admin_0_disputed_areas`

Natural Earth data is public domain: https://www.naturalearthdata.com/about/terms-of-use/

The source downloads are ignored by Git. Use `scripts/download-geography.py` to obtain them. `scripts/prepare-geography.py` strips unused attributes, simplifies and rounds geometry, maps it to the place list, combines constituent units where needed, and identifies the two approximate markers. The prepared geometry is checked into the repository.

Oceania is a generalized study envelope enclosing Natural Earth's Australia, Melanesia, Micronesia, and Polynesia regions (including New Zealand). The definition follows the broad geographic region described by [National Geographic](https://education.nationalgeographic.org/resource/oceania-physical-geography/). The generator constructs a convex hull in Pacific-centered longitude, including intervening ocean such as the Tasman Sea, then splits it at ±180° for GeoJSON rendering and answer checking. The extent is deliberately a study convention, not an official maritime or political boundary.

Balkan Peninsula maps to the `BALKAN PEN.` / `Balkans` feature (`WIKIDATAID: Q23522`) in `ne_10m_geography_regions_polys`. This is a regional outline across country borders, separate from the `Balkan Mts.` feature. Natural Earth's [physical-region boundaries](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-physical-labels/) are generalized study outlines, not surveyed borders.

`data/notes.json` contains the 319 public place names, country notes, and tags extracted from an Ultimate Geography Extended collection. Original Anki IDs, card schedules, review history, flags, capitals, and media are not included. IDs have been replaced with independent slugs. The upstream license for non-image deck content is included here.

`data/answer-aliases.json` lists additional accepted answers for individual places, including North Cyprus, DRC, and shorter island names. The atlas generator adds these to `data/places.json`. Bare “Congo” is excluded because it does not distinguish the two countries. Existing collections can receive additions through `PATCH /api/places/:id` while preserving their current aliases and schedules.
