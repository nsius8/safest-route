/**
 * Shelter service: query Overpass API for nearby shelters (amenity=shelter, building=bunker).
 */
import type { Express } from 'express'
import axios from 'axios'

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
const DEFAULT_RADIUS_M = 2000
const MAX_SHELTERS = 10

interface OverpassNode {
  type: 'node'
  id: number
  lat: number
  lon: number
  tags?: Record<string, string>
}

interface OverpassWay {
  type: 'way'
  id: number
  center?: { lat: number; lon: number }
  lat?: number
  lon?: number
  tags?: Record<string, string>
}

interface OverpassElement {
  type: string
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

interface OverpassResult {
  elements?: OverpassElement[]
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function getLatLon(el: OverpassElement): { lat: number; lon: number } | null {
  if (el.lat != null && el.lon != null) return { lat: el.lat, lon: el.lon }
  if (el.center) return { lat: el.center.lat, lon: el.center.lon }
  return null
}

export async function findNearbyShelters(
  lat: number,
  lon: number,
  radiusM: number = DEFAULT_RADIUS_M
): Promise<{ id: string; lat: number; lon: number; name?: string; distance: number }[]> {
  // Overpass: nodes only (faster); around(radius_m, lat, lon)
  const query = `
[out:json][timeout:15][maxsize:1000000];
(
  node["amenity"="shelter"](around:${radiusM},${lat},${lon});
  node["building"="bunker"](around:${radiusM},${lat},${lon});
);
out;
  `.trim()

  const body = `data=${encodeURIComponent(query)}`
  const opts = {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' as const },
    timeout: 35000,
    validateStatus: () => true,
  }

  let data: OverpassResult | undefined
  let lastError: Error | null = null

  for (const url of OVERPASS_URLS) {
    try {
      const response = await axios.post<OverpassResult>(url, body, opts)
      if (response.status !== 200) {
        const errBody = response.data as unknown as { error?: string; message?: string }
        lastError = new Error(errBody?.error || errBody?.message || `HTTP ${response.status}`)
        continue
      }
      const result = response.data
      if (result?.elements && Array.isArray(result.elements)) {
        data = result
        break
      }
      lastError = new Error('Invalid Overpass response')
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }

  if (!data) {
    throw lastError || new Error('Overpass API unavailable')
  }

  const elements = data?.elements ?? []
  const withCoords: { lat: number; lon: number; name?: string; id: string }[] = []

  for (const el of elements) {
    const pos = getLatLon(el)
    if (!pos) continue
    const name = el.tags?.name
    withCoords.push({
      lat: pos.lat,
      lon: pos.lon,
      name,
      id: `${el.type}-${el.id}`,
    })
  }

  const withDistance = withCoords.map((s) => ({
    ...s,
    distance: haversine(lat, lon, s.lat, s.lon),
  }))

  withDistance.sort((a, b) => a.distance - b.distance)
  return withDistance.slice(0, MAX_SHELTERS)
}

/** Sample route to roughly one point per ~200m for accurate distance-to-route. Coords as [lng, lat][]. */
function sampleRouteDense(routeCoords: number[][], intervalM = 200): number[][] {
  if (!routeCoords?.length) return []
  let totalM = 0
  for (let i = 1; i < routeCoords.length; i++) {
    const [lng1, lat1] = routeCoords[i - 1]
    const [lng2, lat2] = routeCoords[i]
    if (Number.isFinite(lat1) && Number.isFinite(lng1) && Number.isFinite(lat2) && Number.isFinite(lng2)) {
      totalM += haversine(lat1, lng1, lat2, lng2)
    }
  }
  const n = Math.max(routeCoords.length, Math.ceil(totalM / intervalM))
  if (n <= routeCoords.length) return routeCoords
  const out: number[][] = []
  const step = (routeCoords.length - 1) / (n - 1)
  for (let i = 0; i < n; i++) {
    const idx = i === n - 1 ? routeCoords.length - 1 : i * step
    const i0 = Math.floor(idx)
    const i1 = Math.min(i0 + 1, routeCoords.length - 1)
    const t = idx - i0
    const lng = routeCoords[i0][0] + t * (routeCoords[i1][0] - routeCoords[i0][0])
    const lat = routeCoords[i0][1] + t * (routeCoords[i1][1] - routeCoords[i0][1])
    out.push([lng, lat])
  }
  return out
}

/** Min distance in meters from point to polyline (route coords as [lng, lat][]). Uses dense sampling. */
function distanceToRoute(lat: number, lon: number, routeCoords: number[][]): number {
  const sampled = sampleRouteDense(routeCoords, 200)
  if (!sampled.length) return Infinity
  let min = Infinity
  for (const c of sampled) {
    const lng = c[0]
    const latP = c[1]
    if (Number.isFinite(lng) && Number.isFinite(latP)) {
      const d = haversine(lat, lon, latP, lng)
      if (d < min) min = d
    }
  }
  return min
}

const MAX_SHELTERS_ALONG_ROUTE = 25
const ROUTE_SHELTER_BUFFER_M = 2500
/** Approx meters per degree at Israel latitude. */
const M_PER_DEG = 111_000

export async function findSheltersAlongRoute(
  routeCoordinates: number[][]
): Promise<{ id: string; lat: number; lon: number; name?: string; distance: number }[]> {
  if (!routeCoordinates?.length) return []
  let minLat = Infinity,
    maxLat = -Infinity,
    minLon = Infinity,
    maxLon = -Infinity
  for (const c of routeCoordinates) {
    const lng = c[0]
    const lat = c[1]
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      if (lng < minLon) minLon = lng
      if (lng > maxLon) maxLon = lng
    }
  }
  if (minLat === Infinity) return []
  const bufferDeg = ROUTE_SHELTER_BUFFER_M / M_PER_DEG
  const south = minLat - bufferDeg
  const north = maxLat + bufferDeg
  const west = minLon - bufferDeg
  const east = maxLon + bufferDeg

  const query = `
[out:json][timeout:20][maxsize:1000000];
(
  node["amenity"="shelter"](${south},${west},${north},${east});
  node["building"="bunker"](${south},${west},${north},${east});
);
out;
  `.trim()

  const body = `data=${encodeURIComponent(query)}`
  const opts = {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' as const },
    timeout: 35000,
    validateStatus: () => true,
  }

  let data: OverpassResult | undefined
  for (const url of OVERPASS_URLS) {
    try {
      const response = await axios.post<OverpassResult>(url, body, opts)
      if (response.status === 200 && response.data?.elements?.length !== undefined) {
        data = response.data
        break
      }
    } catch (_) {}
  }

  if (!data?.elements?.length) return []

  const withCoords: { lat: number; lon: number; name?: string; id: string }[] = []
  for (const el of data.elements) {
    const pos = getLatLon(el)
    if (!pos) continue
    withCoords.push({
      lat: pos.lat,
      lon: pos.lon,
      name: el.tags?.name,
      id: `${el.type}-${el.id}`,
    })
  }

  const withDistance = withCoords.map((s) => ({
    ...s,
    distance: distanceToRoute(s.lat, s.lon, routeCoordinates),
  }))

  const nearRoute = withDistance.filter((s) => s.distance <= ROUTE_SHELTER_BUFFER_M)
  nearRoute.sort((a, b) => a.distance - b.distance)
  return nearRoute.slice(0, MAX_SHELTERS_ALONG_ROUTE)
}

export function registerShelterRoutes(app: Express): void {
  app.get('/api/shelters/nearby', async (req, res) => {
    try {
      const lat = req.query.lat != null ? Number(req.query.lat) : NaN
      const lon = req.query.lon != null ? Number(req.query.lon) : (req.query.lng != null ? Number(req.query.lng) : NaN)
      const radius = req.query.radius != null ? Number(req.query.radius) : DEFAULT_RADIUS_M

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        res.status(400).json({ error: 'lat and lon (or lng) required' })
        return
      }

      const shelters = await findNearbyShelters(lat, lon, radius)
      res.json({ shelters })
    } catch (e) {
      const msg = axios.isAxiosError(e)
        ? (e.response?.data?.message || e.response?.data?.error || e.message)
        : e instanceof Error ? e.message : 'Shelter search failed'
      console.warn('Shelter search failed:', msg, e)
      res.status(500).json({ error: 'Shelter search failed', detail: String(msg) })
    }
  })

  app.post('/api/shelters/along-route', async (req, res) => {
    try {
      const { coordinates } = req.body || {}
      const coords = Array.isArray(coordinates) ? coordinates : []
      const shelters = await findSheltersAlongRoute(coords)
      res.json({ shelters })
    } catch (e) {
      const msg = axios.isAxiosError(e)
        ? (e.response?.data?.message || e.response?.data?.error || e.message)
        : e instanceof Error ? e.message : 'Shelter search failed'
      console.warn('Shelters along route failed:', msg, e)
      res.status(500).json({ error: 'Shelters along route failed', detail: String(msg) })
    }
  })
}
