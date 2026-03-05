/**
 * Safe route calculation: avoidance polygons from alert history + active alerts, ORS directions.
 */
import type { Express } from 'express'
import axios from 'axios'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { getAlertHistory, getHeatmapData, getAlertHistorySummary, getAlertHistorySummaryBySlot } from './alertService'
import { getActiveAlertSync } from './alertService'
import type { HeatmapPoint } from './alertService'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

const ORS_BASE = 'https://api.openrouteservice.org'
const ORS_API_KEY = process.env.OPENROUTESERVICE_API_KEY || ''

interface CityRecord {
  id: number
  name: string
  value: string
  lat: number
  lng: number
  name_en?: string
  countdown?: number
}

interface PolygonsMap {
  [id: string]: [number, number][] // [lat, lng] per point
}

let citiesList: CityRecord[] = []
let polygonsMap: PolygonsMap = {}

function loadZoneData() {
  try {
    const pkgPath = join(__dirname, '..', 'node_modules', 'pikud-haoref-api')
    const cities = require(join(pkgPath, 'cities.json')) as CityRecord[]
    const polygons = require(join(pkgPath, 'polygons.json')) as PolygonsMap
    citiesList = Array.isArray(cities) ? cities : []
    polygonsMap = polygons && typeof polygons === 'object' ? polygons : {}
  } catch (e) {
    console.warn('Could not load pikud-haoref-api zone data:', e)
  }
}

// Load on first use
function ensureZoneData() {
  if (citiesList.length === 0) loadZoneData()
}

const nameToId = new Map<string, number>()
function getNameToId(): Map<string, number> {
  ensureZoneData()
  if (nameToId.size > 0) return nameToId
  for (const c of citiesList) {
    if (c.value) nameToId.set(c.value, c.id)
    if (c.name) nameToId.set(c.name, c.id)
  }
  return nameToId
}

/** Normalize for search: trim, lowercase (for Latin script). */
function norm(s: string): string {
  return s.trim().toLowerCase()
}

/** Resolve Israeli city/place from bundled cities (Hebrew + English names). */
function geocodeFromCities(query: string): [number, number] | null {
  ensureZoneData()
  const q = query.trim()
  if (!q) return null
  const qNorm = norm(q)
  for (const c of citiesList) {
    if (c.id === 0) continue
    if (c.lat == null || c.lng == null) continue
    if (c.value && (c.value === q || norm(c.value) === qNorm)) return [c.lat, c.lng]
    if (c.name && (c.name === q || norm(c.name) === qNorm)) return [c.lat, c.lng]
    const nameEn = c.name_en
    if (nameEn && (nameEn === q || norm(nameEn) === qNorm)) return [c.lat, c.lng]
    if (c.name && c.name.includes(q)) return [c.lat, c.lng]
    if (nameEn && nameEn.toLowerCase().includes(qNorm)) return [c.lat, c.lng]
  }
  return null
}

/** Polygon as [lat,lng][] -> GeoJSON exterior ring [lng,lat][] closed. */
function toGeoJSONRing(points: [number, number][]): [number, number][] {
  if (!points.length) return []
  const ring = points.map(([lat, lng]) => [lng, lat] as [number, number])
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]])
  return ring
}

interface MultiPolygon {
  type: 'MultiPolygon'
  coordinates: [number, number][][][]
}

/** Build avoidance polygons: high-history zones (top 20%) + all active alert zones. */
async function buildAvoidancePolygons(): Promise<MultiPolygon | null> {
  ensureZoneData()
  const n2id = getNameToId()
  const rings: [number, number][][] = []

  // Active alerts: avoid all mentioned cities
  const active = getActiveAlertSync()
  if (active?.cities?.length) {
    for (const cityName of active.cities) {
      const id = n2id.get(cityName)
      if (id == null) continue
      const key = String(id)
      const raw = polygonsMap[key]
      if (raw?.length) {
        const ring = toGeoJSONRing(raw)
        if (ring.length) rings.push(ring)
      }
    }
  }

  // History: count alerts per city (history "data" often contains city/area name)
  const history = await getAlertHistory()
  const countByCity = new Map<string, number>()
  for (const h of history) {
    const name = (h.data || '').trim()
    if (!name) continue
    countByCity.set(name, (countByCity.get(name) || 0) + 1)
  }

  // Top 20% by count
  const sorted = [...countByCity.entries()].sort((a, b) => b[1] - a[1])
  const topCount = Math.max(1, Math.ceil(sorted.length * 0.2))
  const topNames = new Set(sorted.slice(0, topCount).map(([n]) => n))

  for (const cityName of topNames) {
    const id = n2id.get(cityName)
    if (id == null) continue
    const key = String(id)
    const raw = polygonsMap[key]
    if (raw?.length) {
      const ring = toGeoJSONRing(raw)
      if (ring.length) rings.push(ring)
    }
  }

  if (rings.length === 0) return null
  return {
    type: 'MultiPolygon',
    coordinates: rings.map((r) => [r]),
  }
}

/** Call ORS directions with optional avoid_polygons. */
async function getDirections(
  from: [number, number],
  to: [number, number],
  avoidPolygons: MultiPolygon | null
): Promise<ORSRoute[]> {
  if (!ORS_API_KEY) {
    throw new Error('OPENROUTESERVICE_API_KEY not set')
  }
  const body: Record<string, unknown> = {
    coordinates: [from, to],
  }
  if (avoidPolygons) {
    body.options = { avoid_polygons: avoidPolygons }
  }

  let response
  try {
    response = await axios.post(
      `${ORS_BASE}/v2/directions/driving-car/geojson`,
      body,
      {
        headers: {
          Authorization: ORS_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 28000,
        validateStatus: () => true,
      }
    )
  } catch (err) {
    const msg = axios.isAxiosError(err) ? (err.message || 'Network error') : 'Request failed'
    throw new Error(`OpenRouteService: ${msg}`)
  }

  if (response.status !== 200) {
    const body = response.data
    const msg =
      (typeof body === 'object' && body?.error?.message) ||
      (typeof body === 'object' && body?.message) ||
      (typeof body === 'string' ? body.slice(0, 200) : null) ||
      `HTTP ${response.status}`
    const err = new Error(`OpenRouteService: ${msg}`) as Error & { statusCode?: number }
    if (response.status === 400 || response.status === 404) err.statusCode = 400
    throw err
  }

  const data = response.data
  const features = data?.features
  if (!Array.isArray(features) || features.length === 0) {
    return []
  }

  return features.map((f: { geometry?: { coordinates?: number[][] | number[] }; properties?: { summary?: { distance?: number; duration?: number } } }) => {
    const coords = f.geometry?.coordinates
    let valid: number[][] = []
    if (Array.isArray(coords)) {
      if (coords.length > 0 && Array.isArray(coords[0])) {
        valid = (coords as number[][]).filter((c) => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
      } else if (coords.length >= 2 && typeof coords[0] === 'number') {
        const flat = coords as number[]
        for (let i = 0; i + 1 < flat.length; i += 2) {
          if (Number.isFinite(flat[i]) && Number.isFinite(flat[i + 1])) valid.push([flat[i], flat[i + 1]])
        }
      }
    }
    const summary = f.properties?.summary ?? {}
    return {
      coordinates: valid,
      distance: Number(summary.distance) || 0,
      duration: Number(summary.duration) || 0,
    }
  })
}

interface ORSRoute {
  coordinates: number[][]
  distance: number
  duration: number
}

/**
 * SAFETY / ALERT RISK CALCULATION (two separate metrics)
 *
 * 1) ZONE SCORES (map polygons + "Alert risk in route" % shown in UI)
 *    - Data: alert history (CSV/OREF), aggregated by location. With "by hour": by half-hour slot (0–47).
 *    - For each zone (city polygon) near the route: score = count / maxAlerts (0..1).
 *      count = number of past alerts in that location (or in that slot for "by hour").
 *      maxAlerts = max count over all locations (or that slot), so the busiest place = 1.
 *    - Route-level "Alert risk in route" % = 100 × average(zone scores along route).
 *
 * 2) SAFETY SCORE 0–100 (internal; UI shows alert risk from zones instead)
 *    - Samples the route at SAFETY_SAMPLE_POINTS. For each sample:
 *      - If inside any *active* alert polygon → route gets ACTIVE_ZONE_CAP (e.g. 10).
 *      - Else: sum "exposure" from heatmap points within HEATMAP_RADIUS_M, with linear decay by distance.
 *    - safetyScore = 100 - min(95, exposure × EXPOSURE_SCALE), clamped to 5–100.
 *    - So: low score = high exposure (heatmap or active zone). Used only when there are no zones (fallback).
 */
const SAFETY_SAMPLE_POINTS = 30
const HEATMAP_RADIUS_M = 6000
const EXPOSURE_SCALE = 0.04
const ACTIVE_ZONE_CAP = 10

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/** Sample points evenly along route (coordinates as [lng, lat][]). */
function sampleRoutePoints(coords: number[][], n: number): Array<{ lat: number; lng: number }> {
  if (!coords?.length) return []
  if (coords.length <= n) {
    return coords.map((c) => ({ lng: c[0], lat: c[1] }))
  }
  const out: Array<{ lat: number; lng: number }> = []
  const step = (coords.length - 1) / (n - 1)
  for (let i = 0; i < n; i++) {
    const idx = i === n - 1 ? coords.length - 1 : i * step
    const i0 = Math.floor(idx)
    const i1 = Math.min(i0 + 1, coords.length - 1)
    const t = idx - i0
    const lng = coords[i0][0] + t * (coords[i1][0] - coords[i0][0])
    const lat = coords[i0][1] + t * (coords[i1][1] - coords[i0][1])
    out.push({ lat, lng })
  }
  return out
}

/** Ring as [lng, lat][] for point-in-polygon. */
function pointInRing(lat: number, lng: number, ring: [number, number][]): boolean {
  let inside = false
  const n = ring.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const dy = yj - yi
    if (dy === 0) continue
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / dy + xi) inside = !inside
  }
  return inside
}

/** Get rings for currently active alert zones (each ring is [lng, lat][]). */
function getActiveZoneRings(): [number, number][][] {
  ensureZoneData()
  const active = getActiveAlertSync()
  if (!active?.cities?.length) return []
  const n2id = getNameToId()
  const rings: [number, number][][] = []
  for (const cityName of active.cities) {
    const id = n2id.get(cityName)
    if (id == null) continue
    const raw = polygonsMap[String(id)]
    if (!raw?.length) continue
    rings.push(toGeoJSONRing(raw))
  }
  return rings
}

/** Alert count for a city: exact match on name/value/name_en, then partial match on history keys. */
function getCityAlertCount(c: CityRecord, countByCity: Map<string, number>): number {
  let n = countByCity.get(c.name || '') ?? 0
  if (n > 0) return n
  n = countByCity.get(c.value || '') ?? 0
  if (n > 0) return n
  if (c.name_en) {
    n = countByCity.get(c.name_en) ?? 0
    if (n > 0) return n
  }
  const nameLower = (c.name || '').toLowerCase()
  const valueLower = (c.value || '').toLowerCase()
  const nameEnLower = (c.name_en || '').toLowerCase()
  for (const [key, count] of countByCity) {
    const k = (key || '').trim().toLowerCase()
    if (!k) continue
    if (nameLower && k.includes(nameLower)) return count
    if (valueLower && k.includes(valueLower)) return count
    if (nameEnLower && k.includes(nameEnLower)) return count
  }
  return 0
}

const ZONES_NEAR_ROUTE_M = 8000

/** All zones near or crossing the route (within ZONES_NEAR_ROUTE_M). Score = count/maxAlerts (0..1). Name by lang. Includes occurrences (raw count) per zone. */
function getZonesNearRoute(
  routeCoords: number[][],
  countByCity: Map<string, number>,
  maxAlerts: number,
  lang: 'he' | 'en' = 'he'
): Array<{ coordinates: number[][]; score: number; name: string; occurrences: number }> {
  ensureZoneData()
  const points = sampleRoutePoints(routeCoords, Math.max(SAFETY_SAMPLE_POINTS, 50))
  if (!points.length) return []
  const divisor = maxAlerts > 0 ? maxAlerts : 1
  const nameFor = (c: CityRecord) => (lang === 'he' ? (c.name || c.name_en || c.value || '') : (c.name_en || c.name || c.value || ''))
  const out: Array<{ coordinates: number[][]; score: number; name: string; occurrences: number }> = []
  const seen = new Set<number>()
  for (const c of citiesList) {
    if (c.id === 0 || seen.has(c.id)) continue
    const raw = polygonsMap[String(c.id)]
    if (!raw?.length) continue
    const ring = toGeoJSONRing(raw)
    if (!ring.length) continue
    const anyInside = points.some((p) => pointInRing(p.lat, p.lng, ring))
    if (anyInside) {
      seen.add(c.id)
      const count = getCityAlertCount(c, countByCity)
      out.push({
        coordinates: ring,
        score: count / divisor,
        name: nameFor(c),
        occurrences: count,
      })
      continue
    }
    const centroidLng = ring.reduce((s, p) => s + p[0], 0) / ring.length
    const centroidLat = ring.reduce((s, p) => s + p[1], 0) / ring.length
    let minDist = Infinity
    for (const p of points) {
      const d = haversineMeters(p.lat, p.lng, centroidLat, centroidLng)
      if (d < minDist) minDist = d
    }
    if (minDist <= ZONES_NEAR_ROUTE_M) {
      seen.add(c.id)
      const count = getCityAlertCount(c, countByCity)
      out.push({
        coordinates: ring,
        score: count / divisor,
        name: nameFor(c),
        occurrences: count,
      })
    }
  }
  return out
}

/**
 * Compute safety score 0–100 for a route from alert history (heatmap) and active zones.
 * Lower score = more exposure to alerts.
 */
function computeRouteSafetyScore(
  routeCoords: number[][],
  heatmapPoints: HeatmapPoint[],
  activeRings: [number, number][][]
): number {
  const points = sampleRoutePoints(routeCoords, SAFETY_SAMPLE_POINTS)
  if (!points.length) return 50

  let exposure = 0
  let inActiveCount = 0

  for (const p of points) {
    for (const ring of activeRings) {
      if (pointInRing(p.lat, p.lng, ring)) {
        inActiveCount++
        break
      }
    }
    for (const h of heatmapPoints) {
      const d = haversineMeters(p.lat, p.lng, h.lat, h.lng)
      if (d <= HEATMAP_RADIUS_M) {
        const decay = 1 - d / HEATMAP_RADIUS_M
        exposure += h.weight * decay
      }
    }
  }

  if (inActiveCount > 0) {
    return ACTIVE_ZONE_CAP
  }

  if (heatmapPoints.length === 0) {
    return 50
  }

  const score = 100 - Math.min(95, exposure * EXPOSURE_SCALE)
  return Math.round(Math.max(5, Math.min(100, score)))
}

/** Geocode: first try bundled Israeli cities, then ORS if API key set. */
async function geocode(query: string): Promise<[number, number] | null> {
  const fromCities = geocodeFromCities(query)
  if (fromCities) return fromCities

  if (!ORS_API_KEY) return null
  try {
    const { data } = await axios.get(`${ORS_BASE}/geocode/search`, {
      params: {
        text: query.trim(),
        'boundary.country': 'IL',
      },
      headers: { Authorization: ORS_API_KEY },
      timeout: 8000,
    })
    const feat = data?.features?.[0]
    const coords = feat?.geometry?.coordinates
    if (!coords || coords.length < 2) return null
    return [coords[1], coords[0]] // ORS returns [lng,lat], we use [lat,lng]
  } catch (_) {
    return null
  }
}

interface GeoJSONFeature {
  type: 'Feature'
  properties?: Record<string, unknown>
  geometry: { type: 'Polygon'; coordinates: [number, number][][] }
}
interface GeoJSONFeatureCollection {
  type: 'FeatureCollection'
  features: GeoJSONFeature[]
}

/** Return GeoJSON polygons for currently active alert cities (for map overlay). Names by lang (he = Hebrew, en = English). */
export function getActiveAlertZones(lang: 'he' | 'en' = 'he'): GeoJSONFeatureCollection | null {
  ensureZoneData()
  const active = getActiveAlertSync()
  if (!active?.cities?.length) return null
  const n2id = getNameToId()
  const idToCity = new Map<number, CityRecord>()
  for (const c of citiesList) {
    if (c.id !== 0) idToCity.set(c.id, c)
  }
  const features: GeoJSONFeature[] = []
  for (const cityName of active.cities) {
    const id = n2id.get(cityName)
    if (id == null) continue
    const raw = polygonsMap[String(id)]
    if (!raw?.length) continue
    const ring = toGeoJSONRing(raw)
    if (!ring.length) continue
    const city = idToCity.get(id)
    const displayName = lang === 'en' ? (city?.name_en || cityName) : cityName
    features.push({
      type: 'Feature',
      properties: { name: displayName },
      geometry: { type: 'Polygon', coordinates: [ring] },
    })
  }
  if (features.length === 0) return null
  return { type: 'FeatureCollection', features }
}

/** Check if [lat, lng] is inside any active alert polygon. */
function pointInPolygon(lat: number, lng: number, ring: [number, number][]): boolean {
  let inside = false
  const n = ring.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const x = lng
    const y = lat
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function isInActiveAlertZone(lat: number, lng: number): boolean {
  return getZoneInfo(lat, lng).inZone
}

/** Get zone info for a point: inZone, countdown (seconds), and location name (Hebrew + English). */
export function getZoneInfo(lat: number, lng: number): {
  inZone: boolean
  countdown?: number
  locationName?: string
  locationNameEn?: string
} {
  ensureZoneData()
  const active = getActiveAlertSync()
  if (!active?.cities?.length) return { inZone: false }
  const n2id = getNameToId()
  const idToCity = new Map<number, CityRecord>()
  for (const c of citiesList) {
    if (c.id !== 0) idToCity.set(c.id, c)
  }
  for (const cityName of active.cities) {
    const id = n2id.get(cityName)
    if (id == null) continue
    const raw = polygonsMap[String(id)]
    if (!raw?.length) continue
    const ring = raw.map(([la, ln]) => [ln, la] as [number, number])
    if (pointInPolygon(lat, lng, ring)) {
      const city = idToCity.get(id)
      return {
        inZone: true,
        countdown: city?.countdown,
        locationName: cityName,
        locationNameEn: city?.name_en,
      }
    }
  }
  return { inZone: false }
}

/** Suggest cities by name (Hebrew or English). */
function suggestCities(query: string, limit = 15): Array<{ name: string; name_en?: string; lat: number; lng: number }> {
  ensureZoneData()
  const q = query.trim().toLowerCase()
  if (!q || q.length < 2) return []
  const out: Array<{ name: string; name_en?: string; lat: number; lng: number }> = []
  const seen = new Set<number>()
  for (const c of citiesList) {
    if (c.id === 0 || c.lat == null || c.lng == null) continue
    const nameEn = c.name_en || ''
    const match =
      c.name?.toLowerCase().includes(q) ||
      nameEn.toLowerCase().includes(q) ||
      (c.value && c.value.toLowerCase().includes(q))
    if (match && !seen.has(c.id)) {
      seen.add(c.id)
      out.push({ name: c.name, name_en: c.name_en, lat: c.lat, lng: c.lng })
      if (out.length >= limit) break
    }
  }
  return out
}

/** Suggest places (streets, addresses) via ORS geocode. Returns same shape as suggestCities. */
async function suggestPlacesORS(
  query: string,
  limit = 15
): Promise<Array<{ name: string; name_en?: string; lat: number; lng: number }>> {
  if (!ORS_API_KEY || !query.trim() || query.trim().length < 2) return []
  try {
    const { data } = await axios.get<{ features?: Array<{ geometry?: { coordinates?: number[] }; properties?: { label?: string; name?: string } }> }>(
      `${ORS_BASE}/geocode/search`,
      {
        params: {
          text: query.trim(),
          'boundary.country': 'IL',
          size: Math.min(limit, 20),
        },
        headers: { Authorization: ORS_API_KEY },
        timeout: 8000,
      }
    )
    const features = data?.features ?? []
    const out: Array<{ name: string; name_en?: string; lat: number; lng: number }> = []
    const seen = new Set<string>()
    for (const f of features) {
      const coords = f.geometry?.coordinates
      if (!coords || coords.length < 2 || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) continue
      const lat = coords[1]
      const lng = coords[0]
      const key = `${lat.toFixed(5)},${lng.toFixed(5)}`
      if (seen.has(key)) continue
      seen.add(key)
      const label = (f.properties?.label || f.properties?.name || '').trim() || undefined
      if (!label) continue
      out.push({ name: label, name_en: label, lat, lng })
      if (out.length >= limit) break
    }
    return out
  } catch (_) {
    return []
  }
}

export function registerRouteRoutes(app: Express): void {
  app.get('/api/cities/suggest', async (req, res) => {
    try {
      const q = (req.query.q as string)?.trim() || ''
      const limit = Math.min(25, Math.max(5, parseInt(String(req.query.limit), 10) || 15))
      const lang = (req.query.lang as string) === 'he' ? 'he' : 'en'
      const toLabel = (s: { name: string; name_en?: string }) =>
        lang === 'he' ? (s.name || s.name_en || '') : (s.name_en || s.name || '')
      // Prefer ORS (addresses/streets) when query looks like an address: has a number or multiple words
      const looksLikeAddress = /\d/.test(q) || q.split(/\s+/).length >= 2 || q.length > 12
      const cityList = suggestCities(q, limit)
      const orsLimit = Math.min(limit, looksLikeAddress ? 20 : Math.max(0, limit - cityList.length))
      const orsList = orsLimit > 0 ? await suggestPlacesORS(q, orsLimit) : []
      const seen = new Set<string>()
      const suggestions: Array<{ label: string; lat: number; lng: number }> = []
      const add = (s: { name: string; name_en?: string; lat: number; lng: number }) => {
        const key = `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`
        if (!seen.has(key)) {
          seen.add(key)
          suggestions.push({ label: toLabel(s), lat: s.lat, lng: s.lng })
        }
      }
      if (looksLikeAddress && orsList.length > 0) {
        orsList.forEach(add)
        cityList.forEach(add)
      } else {
        cityList.forEach(add)
        orsList.forEach(add)
      }
      res.json({ suggestions })
    } catch (e) {
      res.status(500).json({ suggestions: [] })
    }
  })

  app.get('/api/geocode', async (req, res) => {
    try {
      const q = req.query.q as string
      if (!q?.trim()) {
        res.status(400).json({ error: 'Missing q' })
        return
      }
      const coords = await geocode(q.trim())
      if (!coords) {
        res.json({ lat: null, lng: null })
        return
      }
      res.json({ lat: coords[0], lng: coords[1] })
    } catch (e) {
      res.status(500).json({ error: 'Geocode failed' })
    }
  })

  /** Fast: directions only (no avoidance, no safety). */
  app.post('/api/route', async (req, res) => {
    try {
      const { from, to } = req.body || {}
      const fromStr = typeof from === 'string' ? from : (from?.address || from?.query)
      const toStr = typeof to === 'string' ? to : (to?.address || to?.query)
      let fromCoords: [number, number] | null = null
      let toCoords: [number, number] | null = null

      if (typeof from === 'object' && typeof from.lat === 'number' && typeof from.lng === 'number') {
        fromCoords = [from.lat, from.lng]
      } else if (fromStr) {
        fromCoords = await geocode(fromStr)
      }
      if (typeof to === 'object' && typeof to.lat === 'number' && typeof to.lng === 'number') {
        toCoords = [to.lat, to.lng]
      } else if (toStr) {
        toCoords = await geocode(toStr)
      }

      if (!fromCoords || !toCoords) {
        res.status(400).json({ error: 'Could not resolve from or to location' })
        return
      }

      if (!ORS_API_KEY) {
        res.status(503).json({
          error: 'Route service not configured',
          detail: 'Set OPENROUTESERVICE_API_KEY to enable routing. Get a free key at https://openrouteservice.org',
        })
        return
      }

      const fromLngLat: [number, number] = [fromCoords[1], fromCoords[0]]
      const toLngLat: [number, number] = [toCoords[1], toCoords[0]]
      const routes = await getDirections(fromLngLat, toLngLat, null)

      const routeList = routes.slice(0, 3).map((r) => ({
        segments: [{ coordinates: r.coordinates, distance: r.distance, duration: r.duration }],
        summary: { distance: r.distance, duration: r.duration },
        safetyScore: 50,
      }))

      res.json({
        routes: routeList,
        from: { lat: fromCoords[0], lng: fromCoords[1] },
        to: { lat: toCoords[0], lng: toCoords[1] },
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (message.includes('API key') || message.includes('not configured')) {
        res.status(503).json({ error: message })
        return
      }
      if ((e as { statusCode?: number }).statusCode === 400) res.status(400).json({ error: message })
      else res.status(500).json({ error: message })
    }
  })

  /** Safety score + zones along route. Body: { coordinates, lang?: 'he'|'en', slot?: 0-47 }. If slot set, zone scores are by half-hour (0=00:00, 1=00:30, ... 47=23:30). */
  app.post('/api/route/safety', async (req, res) => {
    try {
      const { coordinates, lang: bodyLang, slot: bodySlot } = req.body || {}
      const coords = Array.isArray(coordinates) ? coordinates : []
      if (!coords.length) {
        res.status(400).json({ error: 'Missing or invalid coordinates' })
        return
      }
      const lang = bodyLang === 'en' ? 'en' : 'he'
      const slot = typeof bodySlot === 'number' && bodySlot >= 0 && bodySlot <= 47 ? Math.floor(bodySlot) : undefined

      const heatmapPoints = await getHeatmapData().catch(() => [] as HeatmapPoint[])
      const slotSummary = slot != null ? getAlertHistorySummaryBySlot(slot) : null
      const overallSummary = getAlertHistorySummary()
      // When "by hour" has no data for that slot (e.g. OREF history without time), fall back to overall so we don't show 0
      const summary =
        slotSummary && slotSummary.countByLocation.size > 0 ? slotSummary : overallSummary
      const countByCity = summary?.countByLocation ?? new Map<string, number>()
      const maxAlerts = summary?.maxAlerts ?? 1

      let activeRings: [number, number][][] = []
      try {
        activeRings = getActiveZoneRings()
      } catch (_) {}

      let safetyScore = 50
      try {
        safetyScore = computeRouteSafetyScore(coords, heatmapPoints, activeRings)
      } catch (_) {}

      const zonesAlongRoute = getZonesNearRoute(coords, countByCity, maxAlerts, lang)
      // Alert risk % derived from same zone data as polygons (so single number matches map)
      const alertRiskInRoutePct = zonesAlongRoute.length
        ? Math.round(100 * zonesAlongRoute.reduce((s, z) => s + z.score, 0) / zonesAlongRoute.length)
        : Math.round(100 - safetyScore)

      res.json({
        safetyScore,
        alertRiskInRoutePct,
        maxOccurrences: maxAlerts,
        zonesAlongRoute,
      })
    } catch (e) {
      console.warn('Route safety error:', e)
      res.status(500).json({ error: 'Safety calculation failed' })
    }
  })

  /** Legacy: one call that does route + safety. Uses fast route (no avoidance), then safety. */
  app.post('/api/route/safest', async (req, res) => {
    try {
      const { from, to } = req.body || {}
      const fromStr = typeof from === 'string' ? from : (from?.address || from?.query)
      const toStr = typeof to === 'string' ? to : (to?.address || to?.query)
      let fromCoords: [number, number] | null = null
      let toCoords: [number, number] | null = null

      if (typeof from === 'object' && typeof from.lat === 'number' && typeof from.lng === 'number') {
        fromCoords = [from.lat, from.lng]
      } else if (fromStr) {
        fromCoords = await geocode(fromStr)
      }
      if (typeof to === 'object' && typeof to.lat === 'number' && typeof to.lng === 'number') {
        toCoords = [to.lat, to.lng]
      } else if (toStr) {
        toCoords = await geocode(toStr)
      }

      if (!fromCoords || !toCoords) {
        res.status(400).json({ error: 'Could not resolve from or to location' })
        return
      }

      if (!ORS_API_KEY) {
        res.status(503).json({
          error: 'Route service not configured',
          detail: 'Set OPENROUTESERVICE_API_KEY to enable routing. Get a free key at https://openrouteservice.org',
        })
        return
      }

      const fromLngLat: [number, number] = [fromCoords[1], fromCoords[0]]
      const toLngLat: [number, number] = [toCoords[1], toCoords[0]]
      const routes = await getDirections(fromLngLat, toLngLat, null)

      if (!routes.length) {
        res.json({
          routes: [],
          from: { lat: fromCoords[0], lng: fromCoords[1] },
          to: { lat: toCoords[0], lng: toCoords[1] },
          maxOccurrences: 0,
          zonesAlongRoute: [],
        })
        return
      }

      const firstCoords = routes[0].coordinates
      const lang = (req.body?.lang as string) === 'en' ? 'en' : 'he'
      const bodySlot = req.body?.slot
      const slot = typeof bodySlot === 'number' && bodySlot >= 0 && bodySlot <= 47 ? Math.floor(bodySlot) : undefined
      const slotSummary = slot != null ? getAlertHistorySummaryBySlot(slot) : null
      const overallSummary = getAlertHistorySummary()
      const summary =
        slotSummary && slotSummary.countByLocation.size > 0 ? slotSummary : overallSummary
      const countByCity = summary?.countByLocation ?? new Map<string, number>()
      const maxAlerts = summary?.maxAlerts ?? 1

      let activeRings: [number, number][][] = []
      try {
        activeRings = getActiveZoneRings()
      } catch (_) {}
      let safetyScore = 50
      try {
        safetyScore = computeRouteSafetyScore(firstCoords, heatmapPoints, activeRings)
      } catch (_) {}
      const zonesAlongRoute = getZonesNearRoute(firstCoords, countByCity, maxAlerts, lang)
      const alertRiskInRoutePct = zonesAlongRoute.length
        ? Math.round(100 * zonesAlongRoute.reduce((s, z) => s + z.score, 0) / zonesAlongRoute.length)
        : Math.round(100 - safetyScore)

      const safeRoutes = routes.slice(0, 3).map((r, i) => ({
        segments: [{ coordinates: r.coordinates, distance: r.distance, duration: r.duration }],
        summary: { distance: r.distance, duration: r.duration },
        safetyScore: i === 0 ? safetyScore : 50,
        alertRiskInRoutePct: i === 0 ? alertRiskInRoutePct : 50,
      }))

      res.json({
        routes: safeRoutes,
        from: { lat: fromCoords[0], lng: fromCoords[1] },
        to: { lat: toCoords[0], lng: toCoords[1] },
        maxOccurrences: maxAlerts,
        zonesAlongRoute,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      const stack = e instanceof Error ? e.stack : undefined
      console.warn('Route error:', message, stack ?? '')
      let status = 500
      if (message.includes('API key') || message.includes('not configured')) status = 503
      else if ((e as { statusCode?: number }).statusCode === 400) status = 400
      else if (message.includes('150000') || message.includes('distance must not be greater') || message.includes('exceed the server configuration')) {
        status = 400
      }
      let errorMessage = message
      const isTimeout =
        message.includes('timeout') ||
        message.includes('ETIMEDOUT') ||
        (e as { code?: string }).code === 'ECONNABORTED'
      if (isTimeout) {
        errorMessage = 'Route request timed out. OpenRouteService may be slow or unreachable; try again or use a shorter route.'
      } else if (status === 400 && (message.includes('150000') || message.includes('distance'))) {
        errorMessage = 'Route too long. OpenRouteService allows up to 150 km. Try a shorter route or add a waypoint in the middle.'
      }
      res.status(status).json({ error: errorMessage })
    }
  })
}
