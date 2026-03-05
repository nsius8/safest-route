# Safest Route – Alert-Aware Navigation

A Waze-like web app that calculates the **safest driving route** in Israel using:

1. **Alert history** – heatmap of past alerts (Pikud HaOref)
2. **Current alerts** – live alerts and active zones on the map
3. **Shelter finder** – when you’re in an alert zone, directs you to the nearest shelters (OpenStreetMap)

Built with **React**, **Leaflet** (OpenStreetMap), **OpenRouteService** for routing, and a **Node.js** backend that proxies the OREF API.

## Prerequisites

- Node.js 18+
- **OpenRouteService API key** (free at [openrouteservice.org](https://openrouteservice.org)) – required for routing and geocoding
- OREF APIs are only reachable from Israel. Options: **proxy** (`OREF_PROXY`), or **push from a machine in Israel** (see below)

## Setup

```bash
cd safest-route
npm install
```

Create a `.env` in the project root (optional):

```env
PORT=3001
OPENROUTESERVICE_API_KEY=your_key_here
OREF_PROXY=http://user:pass@host:port/   # only if outside Israel
# Long-term history (OREF returns only a short window):
# ALERT_HISTORY_CSV_URL=https://raw.githubusercontent.com/dleshem/israel-alerts-data/main/israel-alerts.csv

# Optional: push alerts from a machine in Israel (no proxy). Set same secret on Render.
# PUSH_URL=https://safest-route.onrender.com
# ALERT_PUSH_SECRET=your-long-secret-min-16-chars
```

**Push from a machine in Israel (e.g. your home):** Run the OREF pusher on a computer that has Israeli IP. It polls OREF and POSTs updates to your Render app so the site gets live alerts without a proxy or port forwarding.

```bash
# On the machine in Israel, set in .env or export:
# PUSH_URL=https://safest-route.onrender.com
# ALERT_PUSH_SECRET=<same secret as on Render, min 16 chars>
npm run pusher
```

On Render, set env var `ALERT_PUSH_SECRET` (same value). The server will then accept pushes and will not poll OREF itself.

## Run

**Development (frontend + backend):**

```bash
npm start
```

- Frontend: http://localhost:5173 (Vite proxy forwards `/api` and `/events` to the server)
- Backend: http://localhost:3001

**Production:**

```bash
npm run build
PORT=3001 OPENROUTESERVICE_API_KEY=your_key node server/index.js
# Serve dist/ with any static server, or point Express to dist/ for a single server
```

For a single process in production you can add static serving of `dist/` in `server/index.ts` and run the server only.

## Features

- **Map**: OpenStreetMap tiles, alert history heatmap, active alert zones (red), route line, shelter markers
- **Route panel**: From/To with geocoding, “Find safest route” (avoids high-alert and active zones when possible)
- **Alerts**: REST + SSE for live alerts; banner with instructions and countdown when you’re in an alert zone
- **Shelters**: “Show nearest shelters” opens a modal and fetches nearby shelters from Overpass (amenity=shelter, building=bunker)
- **i18n**: English / Hebrew toggle and RTL support

## Historical alert data

The live OREF history API often returns only a **short timeframe**. For long-term history (heatmap, zone scores, time-of-day):

- **Option 1 – Public CSV:** Set `ALERT_HISTORY_CSV_URL` to the [israel-alerts-data](https://github.com/dleshem/israel-alerts-data) CSV (2014–present, ~12k+ missile alerts). The server will fetch it once per history request and use it for all zone scoring and heatmap.
- **Option 2 – Build your own:** Run a script from Israel (or behind a proxy) that calls `GetAlarmsHistory.aspx` periodically and appends to a file (see [kerero/israel-alerts-map](https://github.com/kerero/israel-alerts-map) `updateAlertsHistory`), then point the app at that file or serve it via URL.

## API Keys

| Service            | Env variable               | Purpose                    |
|--------------------|----------------------------|----------------------------|
| OpenRouteService   | `OPENROUTESERVICE_API_KEY` | Geocoding + car routing    |
| OREF (Pikud HaOref)| –                          | Alerts (Israel or proxy)   |
| Overpass (OSM)     | –                          | Shelter search (no key)    |

## License

MIT
