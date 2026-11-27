from collections import defaultdict
from itertools import groupby


def boundaries(features, simplify, country_key="ADM0_A3"):
    """Classify shared edges before neighboring polygons are simplified independently."""
    countries = defaultdict(list)
    for index, feature in enumerate(features):
        countries[feature["properties"][country_key]].append(index)
    groups = []
    for members in countries.values():
        if len(members) == 1:
            continue
        rings = []
        owners = {}
        shared = {}
        for index in members:
            geometry = features[index]["geometry"]
            polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
            for polygon in polygons:
                for ring in polygon:
                    edges = []
                    for a, b in zip(ring, ring[1:]):
                        edge = tuple(sorted((tuple(a[:2]), tuple(b[:2]))))
                        if edge[0] == edge[1]:
                            continue
                        owner = owners.setdefault(edge, index)
                        if owner != index:
                            shared[edge] = owner
                        edges.append((edge, a, b))
                    rings.append((index, edges))
        if not shared:
            continue
        outer, inner = [], []
        for index, edges in rings:
            for internal, segment in groupby(edges, key=lambda item: shared.get(item[0])):
                if internal is not None and internal != index:
                    continue  # Draw each shared line only once.
                segment = list(segment)
                line = [segment[0][1]] + [item[2] for item in segment]
                points = simplify(line)
                if len(points) < 4 and line[0] == line[-1]:
                    points = line
                (outer if internal is None else inner).append([[round(x, 5), round(y, 5)] for x, y, *_ in points])
        groups.append(dict(members=members, outer=outer, inner=inner))
    return groups
