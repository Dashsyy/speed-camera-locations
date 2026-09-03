# Speed Camera Locations (កាមេរ៉ាបាញ់ល្បឿន)

Static site listing Cambodia speed-camera locations by national road, with search, tag filtering (new cameras, direction, speed limit, checkpoint, auto camera, toll/stop), and a "which camera am I near?" GPS lookup.

## Structure

- `public/index.html` — page shell
- `public/style.css` — styling (light/dark aware)
- `public/app.js` — fetches `data.json`, renders searchable/filterable road list, and the GPS nearest-camera panel
- `public/data.json` — the camera location data, grouped by national road, each point optionally carrying `lat`/`lng`
- `server.js` — zero-dependency Node static file server (reads `PORT` from env)
- `scripts/generate-coordinates.js` — regenerates `lat`/`lng` for each point (see below)

## Where the coordinates come from

Cambodia's `គ.ម` (km) road markers are measured from a reference point in central Phnom Penh near Wat Phnom/the French Embassy (confirmed via Wikipedia: NH1 starts at Stat Chas Circle Garden there). `scripts/generate-coordinates.js` geocodes each road's named waypoints via OpenStreetMap Nominatim, fetches the real road-following path between them via OSRM, and interpolates each point's position at its declared km distance. It rejects (leaves uncoordinated) any road whose routed distance doesn't roughly match its declared length, since that usually means a waypoint geocoded to the wrong place. Currently unresolved: **NR8, NR11, NR57, NR73** (and NR2/NR57 have no camera points listed at all yet).

For better precision later, the official HOTOSM/OpenStreetMap Cambodia roads export (search "hotosm_khm_roads" on data.humdata.org) has the actual digitized road geometry and could replace this routing-based approximation — but needs a shapefile/GeoPackage parser (GDAL/ogr2ogr or a GIS library) to trace and merge the `ref=NR<n>` tagged ways per road.

Rerun after editing waypoints: `node scripts/generate-coordinates.js`

## Run locally

```bash
npm start
```

Then open http://localhost:3000

## Update data

Edit `public/data.json`. Each road has:

```json
{
  "code": "1",
  "length_km": 167,
  "route": "ភ្នំពេញ - បាវិត (ស្វាយរៀង) ព្រំដែនវៀតណាម",
  "points": [
    { "km": "16", "label": "កៀនស្វាយ", "tags": ["ថ្មី"] }
  ]
}
```

`tags` recognized: `ថ្មី` (new), `ទៅ` / `ត្រឡប់` (direction), `ឆែក` (checkpoint), `Auto Camera`, `40/h` style speed limits, `ស្តុប` / `ចាប់ពន្ធផ្លូវ` (stop/toll).

## Deploy to Railway

### Option A — Railway CLI (no GitHub needed)

```bash
npm i -g @railway/cli
railway login
railway init
railway up
```

### Option B — GitHub

1. Push this folder to a GitHub repo.
2. In Railway, "New Project" → "Deploy from GitHub repo" → select the repo.
3. Railway auto-detects Node via `package.json` and runs `npm start`.

Railway sets `PORT` automatically — `server.js` already reads `process.env.PORT`. No other environment variables are required.
