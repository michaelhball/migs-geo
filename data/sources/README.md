# Public source data

Natural Earth vectors: `nvkelso/natural-earth-vector`, revision
`ca96624a56bd078437bca8184e78163e5039ad19`, downloaded 2026-11-09.

- `ne_10m_admin_0_map_units`
- `ne_10m_geography_marine_polys`
- `ne_10m_lakes`
- `ne_10m_geography_regions_polys`
- `ne_10m_admin_0_disputed_areas`

Natural Earth data is public domain: https://www.naturalearthdata.com/about/terms-of-use/

The source downloads are ignored by Git. Use `scripts/download-geography.py` to obtain them. `scripts/prepare-geography.py` strips unused attributes, simplifies and rounds geometry, maps it to the place list, combines constituent units where needed, and identifies the four approximate markers. The prepared geometry is checked into the repository.

`data/notes.json` contains the 319 public place names, country notes, and tags extracted from an Ultimate Geography Extended collection. Original Anki IDs, card schedules, review history, flags, capitals, and media are not included. IDs have been replaced with independent slugs. The upstream license for non-image deck content is included here.
