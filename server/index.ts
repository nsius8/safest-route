import 'dotenv/config'
import path from 'path'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import express from 'express'
import cors from 'cors'
import {
  getActiveAlertWithListSync,
  getActiveAlertsSync,
  subscribeToAlerts,
  startLiveAlertPolling,
  pushAlert,
  getHeatmapData,
  fetchAndCacheHistory,
  invalidateHistoryCache,
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

// REST: current alert. When active, includes alerts[] (by type) for UI to show/expand multiple types.
app.get('/api/alerts/active', (_req, res) => {
  const payload = getActiveAlertWithListSync()
  res.json(payload ?? { type: 'none', cities: [] })
})

// REST: active alerts by type (for multiple types in parallel, e.g. drone + missile)
app.get('/api/alerts/active-list', (_req, res) => {
  const alerts = getActiveAlertsSync()
  res.json({ alerts })
})

// Push alert from a local machine (e.g. in Israel) that polls OREF. Requires ALERT_PUSH_SECRET.
app.post('/api/alerts/push', (req, res) => {
  const secret = process.env.ALERT_PUSH_SECRET
  if (!secret || secret.length < 16) {
    res.status(501).json({ error: 'Alert push not configured (set ALERT_PUSH_SECRET on server)' })
    return
  }
  const auth = req.headers.authorization
  const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : req.headers['x-alert-push-secret']
  if (token !== secret) {
    res.status(401).json({ error: 'Invalid or missing secret' })
    return
  }
  const body = req.body
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Expected JSON body' })
    return
  }
  if (body.type === 'none') {
    const cities = Array.isArray(body.cities) ? body.cities.map((c: unknown) => String(c)) : []
    pushAlert({ type: 'none', cities })
    res.json({ ok: true, alert: null })
    return
  }
  if (!body.cities || !Array.isArray(body.cities) || body.cities.length === 0) {
    pushAlert(null)
    res.json({ ok: true, alert: null })
    return
  }
  const alert = {
    type: String(body.type || 'missiles'),
    cities: body.cities.map((c: unknown) => String(c)),
    instructions: body.instructions != null ? String(body.instructions) : undefined,
  }
  pushAlert(alert)
  res.json({ ok: true, alert })
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

// Start OREF polling only if not using push-from-local (optional proxy via env: OREF_PROXY)
if (!process.env.ALERT_PUSH_SECRET) {
  startLiveAlertPolling(
    process.env.OREF_PROXY ? { proxy: process.env.OREF_PROXY } : undefined
  )
} else {
  console.log('Alert push mode: server expects alerts from local pusher (OREF not polled here)')
}

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

const IL_TZ = 'Asia/Jerusalem'

function getIsraelDateKey(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: IL_TZ })
}

function getIsraelHour(): number {
  const hourStr = new Date().toLocaleTimeString('en-GB', {
    timeZone: IL_TZ,
    hour: '2-digit',
    hour12: false,
  })
  return parseInt(hourStr, 10) || 0
}

function scheduleDailyHistoryRefresh(): void {
  let lastRunDate = ''
  const check = async () => {
    const hour = getIsraelHour()
    const today = getIsraelDateKey()
    if (hour === 0 && today !== lastRunDate) {
      lastRunDate = today
      invalidateHistoryCache()
      try {
        await fetchAndCacheHistory('he')
        console.log('Alert history cache refreshed (daily 00:00 IL)')
      } catch (e) {
        console.warn('Daily alert history refresh failed:', (e as Error)?.message ?? e)
      }
    }
  }
  setInterval(check, 60 * 60 * 1000)
  check().catch(() => {})
}

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`)
  // Prewarm alert history cache so first page load is fast
  fetchAndCacheHistory('he').then(
    () => console.log('Alert history cache prewarmed'),
    (e) => console.warn('Alert history prewarm failed:', (e as Error)?.message ?? e)
  )
  scheduleDailyHistoryRefresh()
})
