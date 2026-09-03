# Refines public/data.json coordinates using a real OSM road-geometry export
# (a GeoPackage, e.g. the HOTOSM Cambodia roads dataset from HDX --
# search "hotosm_khm_roads" on data.humdata.org). Unlike
# generate-coordinates.js (which asks a routing engine for *a* path between
# two towns), this traces the literal way(s) tagged as each national road:
# it matches road name/name_en/name_km/name_latin against each road number,
# builds a graph from only those matched segments, closes small topology
# gaps (adjacent map segments that don't quite share a node -- common in
# generalized/simplified exports), and finds the shortest path between the
# road's known waypoints through that graph.
#
# Requires a local .gpkg (not checked into git -- see .gitignore). Put the
# file's path below and run: python3 scripts/build_from_gpkg.py
#
# Only overwrites a road's points if the resulting path's total distance is
# within 20% of the road's declared length -- otherwise it's more likely a
# bad merge (e.g. bridging into a parallel "construction" realignment tagged
# with the same name) than a real result, and the existing coordinates
# (from generate-coordinates.js) are left untouched.
#
# Coverage caveats found when this was last run: NR59 and NR73 have zero
# tagged segments in the HOTOSM export (can't be fixed by this script at
# all). NR3, NR4, NR6, NR7, NR8, NR57, NR62, NR76, NR78 had topology too
# fragmented to safely bridge with the default 20m gap-closing distance --
# increasing GAP_CLOSE_KM per road (see build_graph) may recover some of
# these, at the risk of bad merges like the one this script's own guard
# rejected for NR5 (jumped to 555km vs a declared 408km).
import sqlite3, re, struct, math, heapq, json, sys

DB = "/Users/heng.sunhour/Desktop/person_project/police-area/roads.gpkg"
DATA_PATH = "/Users/heng.sunhour/Desktop/person_project/police-area/public/data.json"

# Known-good waypoint coordinates, reused from the earlier Nominatim geocoding
# pass (lon, lat order to match the gpkg geometry convention used below).
WAYPOINTS = {
    "1": [(104.9232122,11.5761015), (105.2868449,11.2640905), (105.800289,11.083888), (106.1715979,11.0753562)],
    "2": [(104.9232122,11.5761015), (104.7830181,10.9875805), (104.921897,10.6097551)],
    "3": [(104.9232122,11.5761015), (104.1810212,10.6099141), (103.8190054,10.705124)],
    "4": [(104.9232122,11.5761015), (104.5194625,11.4647156), (103.5223365,10.6220485)],
    "5": [(104.9232122,11.5761015), (103.9178235,12.5377547), (103.1966659,13.0998526), (102.5708301,13.6593962)],
    "6": [(104.9232122,11.5761015), (104.8879197,12.6687923), (103.8590321,13.3617562), (102.9732218,13.5800209)],
    "7": [(105.0694434,12.0514079), (105.4628346,11.9921855), (106.0200894,12.4889566), (105.9712397,13.5316927)],
    "8": [(105.00962,11.7467657), (105.3381443,11.4751247), (105.837834,11.7501753)],
    "11": [(105.2868449,11.2640905), (105.6532755,11.9114877)],
    "57": [(103.1966659,13.0998526), (102.6051776,12.8551384)],
    "62": [(104.8249107,12.7915777), (104.9809556,13.8057796), (104.6802855,14.3917493)],
    "68": [(103.4168275,13.5888453), (103.6947347,14.4158008)],
    "76": [(106.4204015,12.0722176), (107.1596387,12.4420242)],
    "78": [(105.9712397,13.5316927), (106.9873662,13.7414754)],
}

ROAD_CODES = list(WAYPOINTS.keys())

def name_variants(code):
    return [
        rf"national\s*(highway|road|route)\s*0*{code}\b",
        rf"nr\s*0*{code}\b",
        rf"qu[ốo]c\s*l[ộo]\s*0*{code}\b",
    ]

def khmer_num(n):
    digits = "០១២៣៤៥៦៧៨៩"
    return "".join(digits[int(c)] for c in str(n))

def matches_road(name, name_en, name_km, name_latin, code):
    hay = " ".join(x or "" for x in [name, name_en, name_km, name_latin]).lower()
    for pat in name_variants(code):
        if re.search(pat, hay, re.IGNORECASE):
            return True
    km_pat = rf"ផ្លូវជាតិលេខ\s*{khmer_num(code)}\b"
    if (name_km and re.search(km_pat, name_km)) or (name and re.search(km_pat, name)):
        return True
    return False

def parse_gpkg_geom(blob):
    if blob is None or len(blob) < 8 or blob[0:2] != b"GP":
        return None
    flags = blob[3]
    envelope_ind = (flags >> 1) & 0x07
    envelope_len = {0:0, 1:32, 2:48, 3:48, 4:64}.get(envelope_ind, 0)
    offset = 8 + envelope_len
    return parse_wkb(blob[offset:])

def parse_wkb(wkb):
    bo = "<" if wkb[0] == 1 else ">"
    gtype = struct.unpack(bo+"I", wkb[1:5])[0]
    base_type = gtype % 1000
    pos = 5
    lines = []
    if base_type == 2:
        n = struct.unpack(bo+"I", wkb[pos:pos+4])[0]; pos += 4
        pts = []
        for _ in range(n):
            x, y = struct.unpack(bo+"dd", wkb[pos:pos+16]); pos += 16
            pts.append((x, y))
        lines.append(pts)
    elif base_type == 5:
        nl = struct.unpack(bo+"I", wkb[pos:pos+4])[0]; pos += 4
        for _ in range(nl):
            bo2 = "<" if wkb[pos] == 1 else ">"
            pos += 1
            struct.unpack(bo2+"I", wkb[pos:pos+4]); pos += 4
            n = struct.unpack(bo2+"I", wkb[pos:pos+4])[0]; pos += 4
            pts = []
            for _ in range(n):
                x, y = struct.unpack(bo2+"dd", wkb[pos:pos+16]); pos += 16
                pts.append((x, y))
            lines.append(pts)
    return lines

def haversine_km(a, b):
    R = 6371.0
    lon1, lat1 = a; lon2, lat2 = b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2-lat1)
    dlmb = math.radians(lon2-lon1)
    h = math.sin(dphi/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dlmb/2)**2
    return 2*R*math.asin(math.sqrt(h))

def node_key(pt, precision=5):
    return (round(pt[0], precision), round(pt[1], precision))

class UnionFind:
    def __init__(self):
        self.parent = {}
    def find(self, x):
        self.parent.setdefault(x, x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x
    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[ra] = rb

def build_graph(lines, gap_close_km=0.02):
    raw_edges = []  # (a, b, dist)
    degree = {}
    for pts in lines:
        for i in range(len(pts) - 1):
            a, b = node_key(pts[i]), node_key(pts[i+1])
            if a == b:
                continue
            d = haversine_km(pts[i], pts[i+1])
            raw_edges.append((a, b, d))
            degree[a] = degree.get(a, 0) + 1
            degree[b] = degree.get(b, 0) + 1

    # Close small gaps: merge dangling endpoints (degree==1) that are within
    # gap_close_km of each other, using a coarse grid to avoid O(n^2).
    dangling = [n for n, d in degree.items() if d == 1]
    cell = gap_close_km / 111.0  # ~degrees per km, rough
    buckets = {}
    for n in dangling:
        bx, by = int(n[0] / cell), int(n[1] / cell)
        buckets.setdefault((bx, by), []).append(n)

    uf = UnionFind()
    for n in dangling:
        bx, by = int(n[0] / cell), int(n[1] / cell)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for other in buckets.get((bx+dx, by+dy), []):
                    if other == n:
                        continue
                    if haversine_km(n, other) <= gap_close_km:
                        uf.union(n, other)

    graph = {}
    for a, b, d in raw_edges:
        ra, rb = uf.find(a), uf.find(b)
        if ra == rb:
            continue
        graph.setdefault(ra, []).append((rb, d))
        graph.setdefault(rb, []).append((ra, d))
    return graph

def nearest_node(graph, pt, max_km=15.0):
    best, best_d = None, max_km
    for node in graph:
        d = haversine_km(pt, node)
        if d < best_d:
            best, best_d = node, d
    return best, best_d

def component_sizes(graph):
    seen = set()
    sizes = []
    for start in graph:
        if start in seen:
            continue
        stack = [start]
        seen.add(start)
        n = 0
        while stack:
            u = stack.pop()
            n += 1
            for v, _ in graph.get(u, []):
                if v not in seen:
                    seen.add(v)
                    stack.append(v)
        sizes.append(n)
    return sorted(sizes, reverse=True)

def dijkstra(graph, start, end):
    dist = {start: 0}
    prev = {}
    pq = [(0, start)]
    visited = set()
    while pq:
        d, u = heapq.heappop(pq)
        if u in visited:
            continue
        visited.add(u)
        if u == end:
            break
        for v, w in graph.get(u, []):
            nd = d + w
            if nd < dist.get(v, float("inf")):
                dist[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, v))
    if end not in dist:
        return None
    path = [end]
    while path[-1] != start:
        path.append(prev[path[-1]])
    path.reverse()
    return path

def build_cumulative(path):
    cum = [0.0]
    for i in range(1, len(path)):
        cum.append(cum[i-1] + haversine_km(path[i-1], path[i]))
    return cum

def point_at_km(path, cum, target_km):
    total = cum[-1]
    if target_km <= 0:
        return path[0]
    if target_km >= total:
        return path[-1]
    lo, hi = 0, len(cum) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if cum[mid] < target_km:
            lo = mid + 1
        else:
            hi = mid
    i = lo
    if i == 0:
        return path[0]
    seg_start, seg_end = cum[i-1], cum[i]
    t = 0 if seg_end == seg_start else (target_km - seg_start) / (seg_end - seg_start)
    ax, ay = path[i-1]; bx, by = path[i]
    return (ax + (bx-ax)*t, ay + (by-ay)*t)

def first_km_number(km_field):
    if not km_field:
        return None
    m = re.search(r"\d+(\.\d+)?", str(km_field))
    return float(m.group(0)) if m else None

def main():
    con = sqlite3.connect(DB)
    cur = con.cursor()
    cur.execute("SELECT name, name_en, name_km, name_latin, geom FROM roads WHERE highway IS NOT NULL")
    rows = cur.fetchall()

    lines_by_code = {c: [] for c in ROAD_CODES}
    for name, name_en, name_km, name_latin, geom in rows:
        for code in ROAD_CODES:
            if matches_road(name, name_en, name_km, name_latin, code):
                geo = parse_gpkg_geom(geom)
                if geo:
                    lines_by_code[code].extend(geo)

    data = json.load(open(DATA_PATH, encoding="utf-8"))
    road_by_code = {r["code"]: r for r in data["roads"]}

    report = []
    for code in ROAD_CODES:
        lines = lines_by_code[code]
        road = road_by_code.get(code)
        if not lines or not road:
            report.append(f"NR{code}: no tagged segments found, skipped")
            continue
        graph = build_graph(lines)
        comps = component_sizes(graph)
        report.append(f"NR{code}: {len(lines)} lines, {len(graph)} nodes, components (top5)={comps[:5]}")
        wps = WAYPOINTS[code]
        snapped = []
        ok = True
        for wi, wp in enumerate(wps):
            node, d = nearest_node(graph, wp, max_km=50.0)
            if node is None or d > 15.0:
                ok = False
                report.append(f"NR{code}: waypoint {wi} nearest tagged node is {d:.1f} km away, skipped")
                break
            snapped.append(node)
        if not ok:
            continue

        full_path = [snapped[0]]
        broken = False
        for i in range(len(snapped) - 1):
            seg = dijkstra(graph, snapped[i], snapped[i+1])
            if seg is None:
                report.append(f"NR{code}: no connected path between waypoint {i} and {i+1}, skipped")
                broken = True
                break
            full_path.extend(seg[1:])
        if broken:
            continue

        cum = build_cumulative(full_path)
        total_km = cum[-1]
        declared = road["length_km"]
        deviation = abs(total_km - declared) / declared
        limit = 0.20
        flag = "  <-- REJECTED (bad merge or genuinely different length)" if deviation > limit else ""
        report.append(f"NR{code}: graph path {total_km:.1f} km (declared {declared} km, {deviation*100:.0f}% diff) -- {len(graph)} nodes{flag}")
        if deviation > limit:
            continue

        applied = 0
        for point in road["points"]:
            km = first_km_number(point.get("km"))
            if km is None:
                continue
            lon, lat = point_at_km(full_path, cum, km)
            point["lat"] = round(lat, 5)
            point["lng"] = round(lon, 5)
            point["source"] = "gpkg"
            applied += 1
        report.append(f"  -> applied coordinates to {applied}/{len(road['points'])} points")

    print("\n".join(report))
    json.dump(data, open(DATA_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    open(DATA_PATH, "a").write("\n")
    print("\nWrote", DATA_PATH)

if __name__ == "__main__":
    main()
