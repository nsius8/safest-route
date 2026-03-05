import 'dotenv/config'
import path from 'path'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import express from 'express'
import cors from 'cors'
import {
  getActiveAlertSync,
  subscribeToAlerts,
  startLiveAlertPolling,
  getHeatmapData,
  fetchAndCacheHistory,
} from './alertService'
import { registerRouteRoutes, getActiveAlertZones, getZoneInfo } from './routeService'
import { registerShelterRoutes } from './shelterService'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT ?? 3001

app.use(cors())
app.use(express.json())

// Health
app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

// REST: current alert
app.get('/api/alerts/active', (_req, res) => {
  const alert = getActiveAlertSync()
  res.json(alert ?? { type: 'none', cities: [] })
})

// REST: alert history – invoked on site load with ?lang=he|en; fetches OREF/CSV, missile-only. Cached for HISTORY_CACHE_TTL_MS. Returns summary only (countByLocation, maxAlerts) for speed; full history is kept server-side for heatmap/safety.
app.get('/api/alerts/history', async (req, res) => {
  try {
    const lang = req.query.lang === 'en' ? 'en' : 'he'
    const result = await fetchAndCacheHistory(lang)
    res.json({
      countByLocation: result.countByLocation,
      maxAlerts: result.maxAlerts,
    })
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch history' })
  }
})

// REST: heatmap points [lat, lng, weight]
app.get('/api/alerts/heatmap', async (_req, res) => {
  try {
    const points = await getHeatmapData()
    res.json({ points })
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch heatmap' })
  }
})

// REST: active alert zone polygons (GeoJSON). ?lang=he|en for display names.
app.get('/api/alerts/active-zones', (req, res) => {
  try {
    const lang = req.query.lang === 'en' ? 'en' : 'he'
    const fc = getActiveAlertZones(lang)
    res.json(fc ?? { type: 'FeatureCollection', features: [] })
  } catch (e) {
    res.status(500).json({ type: 'FeatureCollection', features: [] })
  }
})

// REST: check if point is in active alert zone; returns inZone, countdown (s), locationName, locationNameEn
app.get('/api/alerts/in-zone', (req, res) => {
  const lat = req.query.lat != null ? Number(req.query.lat) : NaN
  const lng = req.query.lng != null ? Number(req.query.lng) : NaN
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ inZone: false })
    return
  }
  res.json(getZoneInfo(lat, lng))
})

// SSE: live alerts stream
app.get('/events/alerts', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const unsubscribe = subscribeToAlerts((alert) => {
    res.write(`data: ${JSON.stringify(alert ?? { type: 'none', cities: [] })}\n\n`)
  })

  req.on('close', () => unsubscribe())
})

registerRouteRoutes(app)
registerShelterRoutes(app)

// Start OREF polling (optional proxy via env: OREF_PROXY=http://user:pass@host:port/)
startLiveAlertPolling(
  process.env.OREF_PROXY ? { proxy: process.env.OREF_PROXY } : undefined
)

// Production (e.g. Render): serve Vite build and SPA fallback when dist exists
const distPath = path.join(__dirname, '..', 'dist')
if (existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get('*', (_req, res, next) => {
    res.sendFile(path.join(distPath, 'index.html'), (err) => {
      if (err) next()
    })
  })
}

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`)
  // Prewarm alert history cache so first page load is fast
  fetchAndCacheHistory('he').then(
    () => console.log('Alert history cache prewarmed'),
    (e) => console.warn('Alert history prewarm failed:', (e as Error)?.message ?? e)
  )
})
