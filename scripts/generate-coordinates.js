// Fills in lat/lng for each camera point in public/data.json by geocoding
// each road's named waypoints (Nominatim/OpenStreetMap) and routing between
// them (OSRM), then interpolating each point's position along the real
// road geometry at its declared km distance from the road's start.
//
// Rerun with: node scripts/generate-coordinates.js
//
// Roads NOT covered (left without coordinates) because the routed distance
// didn't match the declared road length within tolerance -- meaning either
// a waypoint geocoded to the wrong place, or OSRM chose a shorter path than
// the real named road (common on minor/rural roads with parallel routes):
// NR8, NR11, NR57, NR73. Also NR2 and NR57 have no camera points listed yet.
// To improve these, either find better waypoint names below, or replace this
// approach with real OSM way geometry tagged ref=NR<n> (e.g. from the
// HOTOSM Cambodia roads export on HDX: data.humdata.org, search
// "hotosm_khm_roads") traced and merged per road -- more accurate but needs
// a shapefile/GeoPackage parser (GDAL/ogr2ogr or a JS/Python GIS lib).
const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "public", "data.json");

// Waypoint query chains per road code, ordered along the route.
// Use the actual town name where it differs from the province name
// (several provincial capitals were officially renamed and no longer
// share the province's name: Kampong Speu -> Chbar Mon, Takeo -> Doun Kaev,
// Kampong Thom -> Steung Saen, Tbong Khmum -> Suong).
const ROAD_WAYPOINTS = {
  "1": ["Wat Phnom, Phnom Penh, Cambodia", "Neak Loeung, Cambodia", "Svay Rieng, Cambodia", "Bavet border checkpoint, Cambodia"],
  "2": ["Wat Phnom, Phnom Penh, Cambodia", "Doun Kaev, Takeo, Cambodia", "Phnom Den, Kiri Vong, Cambodia"],
  "3": ["Wat Phnom, Phnom Penh, Cambodia", "Kampot, Cambodia", "Veal Renh, Cambodia"],
  "4": ["Wat Phnom, Phnom Penh, Cambodia", "Chbar Mon, Kampong Speu, Cambodia", "Sihanoukville, Cambodia"],
  "5": ["Wat Phnom, Phnom Penh, Cambodia", "Pursat, Cambodia", "Battambang, Cambodia", "Poipet, Cambodia"],
  "6": ["Wat Phnom, Phnom Penh, Cambodia", "Kampong Thom, Cambodia", "Siem Reap, Cambodia", "Sisophon, Cambodia"],
  "7": ["Skun, Cambodia", "Kampong Cham, Cambodia", "Kratie, Cambodia", "Stung Treng, Cambodia"],
  "8": ["Prek Tamak, Kandal, Cambodia", "Prey Veng, Cambodia", "Ponhea Kraek, Cambodia"],
  "11": ["Neak Loeung, Cambodia", "Suong, Tbong Khmum, Cambodia"],
  "57": ["Battambang, Cambodia", "Pailin, Cambodia"],
  "59": ["Pailin, Cambodia", "Poipet, Cambodia"],
  "62": ["Kampong Svay, Kampong Thom, Cambodia", "Tbeng Meanchey, Preah Vihear, Cambodia", "Preah Vihear Temple, Cambodia"],
  "68": ["Kralanh, Cambodia", "O Smach, Cambodia"],
  "73": ["Chamkar Leu, Cambodia", "Chhlong, Kratie, Cambodia", "Kratie, Cambodia"],
  "76": ["Snuol, Kratie, Cambodia", "Sen Monorom, Mondulkiri, Cambodia"],
  "78": ["Stung Treng, Cambodia", "Banlung, Cambodia"],
};

// Roads where the waypoint chain intentionally stops short of the full
// declared distance (e.g. no geocodable point at the border crossing), so
// comparing against the road's full declared length would be meaningless.
const EXPECTED_LENGTH_OVERRIDE = {
  "7": 335, // Skun -> Kampong Cham -> Kratie -> Stung Treng only (no Laos border point)
};

// Roads with verified high-confidence place/city endpoints where the route
// still deviates a bit from the declared length (likely real road curvature
// or an imprecise declared figure, not a bad waypoint) — widen tolerance.
const TOLERANCE_OVERRIDE = {
  "78": 0.2,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PLACE_TYPES = new Set(["city", "town", "village", "hamlet", "suburb"]);

async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
    query
  )}&format=json&limit=8&countrycodes=kh`;
  const res = await fetch(url, {
    headers: { "User-Agent": "police-area-speed-camera-app/1.0 (contact: sunhour012@gmail.com)" },
  });
  const arr = await res.json();
  if (!arr.length) return null;
  // Prefer an actual settlement point (class=place, type=city/town/village)
  // over an administrative boundary (which for Cambodia often means the
  // *province* polygon when the town shares its name with the province).
  // Failing that, among administrative boundaries prefer the most LOCAL one
  // (highest place_rank = smallest area, e.g. commune over province).
  let best = arr.find((r) => r.class === "place" && PLACE_TYPES.has(r.type));
  if (!best) {
    const admin = arr.filter((r) => r.class === "boundary" && r.type === "administrative");
    best = admin.length
      ? admin.reduce((a, b) => (b.place_rank > a.place_rank ? b : a))
      : arr[0];
  }
  return { lat: parseFloat(best.lat), lon: parseFloat(best.lon), display: best.display_name, class: best.class, type: best.type };
}

function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function osrmRoute(coords) {
  // coords: array of {lat, lon}
  const coordStr = coords.map((c) => `${c.lon},${c.lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.code !== "Ok") throw new Error("OSRM failed: " + data.code);
  return data.routes[0];
}

function buildCumulative(geometryCoords) {
  // geometryCoords: [[lon,lat], ...]
  const cum = [0];
  for (let i = 1; i < geometryCoords.length; i++) {
    cum.push(cum[i - 1] + haversine(geometryCoords[i - 1], geometryCoords[i]));
  }
  return cum;
}

function pointAtDistance(geometryCoords, cum, targetMeters) {
  if (targetMeters <= 0) return geometryCoords[0];
  const total = cum[cum.length - 1];
  if (targetMeters >= total) return geometryCoords[geometryCoords.length - 1];
  // binary search
  let lo = 0,
    hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < targetMeters) lo = mid + 1;
    else hi = mid;
  }
  const i = lo;
  if (i === 0) return geometryCoords[0];
  const segStart = cum[i - 1];
  const segEnd = cum[i];
  const t = segEnd === segStart ? 0 : (targetMeters - segStart) / (segEnd - segStart);
  const a = geometryCoords[i - 1];
  const b = geometryCoords[i];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function firstKmNumber(kmField) {
  if (!kmField) return null;
  const match = String(kmField).match(/\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  const geocodeCache = {};
  const results = {};

  for (const road of data.roads) {
    const queries = ROAD_WAYPOINTS[road.code];
    if (!queries) {
      console.log(`skip road ${road.code}: no waypoints defined`);
      continue;
    }
    const coords = [];
    let ok = true;
    for (const q of queries) {
      if (!geocodeCache[q]) {
        process.stdout.write(`geocoding: ${q} ... `);
        try {
          const g = await geocode(q);
          if (!g) {
            console.log("NOT FOUND");
            ok = false;
            break;
          }
          geocodeCache[q] = g;
          console.log(`${g.lat},${g.lon} [${g.class}/${g.type}]`);
        } catch (e) {
          console.log("ERROR " + e.message);
          ok = false;
          break;
        }
        await sleep(1100);
      }
      coords.push(geocodeCache[q]);
    }
    if (!ok || coords.length < 2) {
      console.log(`road ${road.code}: geocoding incomplete, skipping route`);
      continue;
    }

    try {
      const route = await osrmRoute(coords);
      const geometry = route.geometry.coordinates; // [lon,lat]
      const cum = buildCumulative(geometry);
      const totalKm = cum[cum.length - 1] / 1000;
      const expectedKm = EXPECTED_LENGTH_OVERRIDE[road.code] ?? road.length_km;
      const deviation = Math.abs(totalKm - expectedKm) / expectedKm;
      const limit = TOLERANCE_OVERRIDE[road.code] ?? 0.15;
      const flag = deviation > limit ? `  <-- REJECTED (>${limit * 100}% off declared length, likely bad waypoint)` : "";
      console.log(`road ${road.code}: routed total ${totalKm.toFixed(1)} km (declared ${road.length_km} km, ${(deviation * 100).toFixed(0)}% diff)${flag}`);
      if (deviation > limit) continue;
      results[road.code] = { geometry, cum, totalKm };
    } catch (e) {
      console.log(`road ${road.code}: OSRM error - ${e.message}`);
    }
    await sleep(300);
  }

  // Apply interpolated coordinates to points
  for (const road of data.roads) {
    const r = results[road.code];
    if (!r) continue;
    const routeTotalM = r.cum[r.cum.length - 1];
    for (const point of road.points) {
      const km = firstKmNumber(point.km);
      if (km === null) continue;
      // Don't extrapolate a pin past where our mapped route actually reaches.
      if (km * 1000 > routeTotalM + 3000) continue;
      const [lon, lat] = pointAtDistance(r.geometry, r.cum, km * 1000);
      point.lat = Math.round(lat * 1e5) / 1e5;
      point.lng = Math.round(lon * 1e5) / 1e5;
    }
  }

  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n");
  console.log("Done. data.json updated.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
