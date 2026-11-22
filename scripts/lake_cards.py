"""Prepare named study places from the same polygons as the inland-water layer."""
from collections import defaultdict
from math import cos, radians
import re


# Homonymous lakes, including two pairs with duplicated source Wikidata IDs.
QUALIFIERS = {
    1159107451: "Northwest Territories", 1159107587: "Ontario",
    1159107475: "New Brunswick", 1159107521: "Newfoundland",
    1159114429: "Tampere area", 1159121605: "Säkylä area",
    1159113781: "northern Yamal", 1159121139: "southern Yamal",
}

# Natural Earth maps a few constituent bays as separate lake polygons.
BAYS = {"McLeod Bay": "Great Slave Lake", "Whitefish Bay": "Lake Superior",
        "Georgian Bay": "Lake Huron", "Saginaw Bay": "Lake Huron"}


def continent(point, continents):
    """Use the enclosing or closest continental outline, including offshore islands."""
    x, y = point
    scale = cos(radians(y))
    best_distance = float("inf")
    result = "World"
    for name, rings in continents:
        for ring in rings:
            inside = False
            for (a, b), (c, d) in zip(ring, ring[1:]):
                if (b > y) != (d > y) and x < a + (c - a) * (y - b) / (d - b):
                    inside = not inside
                dx, dy = (c - a) * scale, d - b
                px, py = (x - a) * scale, y - b
                length = dx * dx + dy * dy
                t = max(0, min(1, (dx * px + dy * py) / length)) if length else 0
                distance = (px - t * dx) ** 2 + (py - t * dy) ** 2
                if distance < best_distance:
                    result, best_distance = name, distance
            if inside:
                return name
    return result


def prepare_lake_cards(lakes, regions, compact, deck):
    existing_water = {p["name"] for p in deck if p["kind"] in ("water", "lake")}
    continents = []
    for f in regions:
        if f["properties"]["FEATURECLA"] == "Continent":
            name = f["properties"]["NAME"].title()
            rings = [p[0] for p in compact(f["geometry"])["coordinates"]]
            continents.append(("Oceania" if name == "Australia" else name, rings))

    groups = defaultdict(list)
    for lake in lakes:
        p = lake["properties"]
        name = p["name"] or p["name_en"]
        if not name and p["name_alt"] == "Tikchik Lakes":
            name = "Tikchik Lakes"
        if not name or p["featurecla"] not in ("Lake", "Alkaline Lake"):
            continue
        if name in existing_water or name in ("North Aral Sea", "South Aral Sea"):
            continue
        qualifier = QUALIFIERS.get(p["ne_id"])
        groups[(name, qualifier)].append(lake)

    places = []
    for (name, qualifier), features in groups.items():
        aliases = {f["properties"]["name_en"] for f in features} - {None, ""}
        for f in features:
            for alt in re.split(r"[|,]", f["properties"]["name_alt"] or ""):
                if alt.strip() and alt.strip() not in ("Great Lakes", "Finger Lakes", "Vistula Lagoon"):
                    aliases.add(alt.strip())
        for prefix in ("Lake ", "Ozero ", "Lago de ", "Lago ", "Lac "):
            if name.startswith(prefix):
                short = name[len(prefix):]
                aliases.update([short, "Lake " + short])
        if name.endswith(" Lake"):
            aliases.add(name[:-5])
        display = f"{name} ({qualifier})" if qualifier else name
        aliases.add(name)
        components = list(features)
        for bay, parent in BAYS.items():
            if parent == name:
                components.extend(groups.get((bay, None), []))
        polygons = [poly for f in components for poly in compact(f["geometry"])["coordinates"]]
        point = polygons[0][0][0]
        ident = min(f["properties"]["ne_id"] for f in features)
        places.append(dict(id=f"lake-{ident}", name=display, kind="lake",
                           region=continent(point, continents), center=point,
                           geometry=dict(type="MultiPolygon", coordinates=polygons),
                           aliases=sorted(aliases - {display}), info="", tags=[],
                           source="Natural Earth 1:10m lakes", small=False,
                           approximate=False, archived=False))
    return places
