# Speed Camera Locations (កាមេរ៉ាបាញ់ល្បឿន)

Static site listing Cambodia speed-camera locations by national road, with search and tag filtering (new cameras, direction, speed limit, checkpoint, auto camera, toll/stop).

## Structure

- `public/index.html` — page shell
- `public/style.css` — styling (light/dark aware)
- `public/app.js` — fetches `data.json`, renders searchable/filterable road list
- `public/data.json` — the camera location data, grouped by national road
- `server.js` — zero-dependency Node static file server (reads `PORT` from env)

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
