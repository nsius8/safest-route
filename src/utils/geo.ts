import type { LatLng } from '../types'

/**
 * Haversine distance in meters between two points.
 */
export function haversineDistance(a: LatLng, b: LatLng): number {
  const R = 6371000 // Earth radius in meters
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
  return R * c
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * Check if a point is inside a polygon (ray casting).
 * Polygon: array of [lng, lat] (GeoJSON order).
 */
export function pointInPolygon(
  point: LatLng,
  polygon: [number, number][]
): boolean {
  const [lng, lat] = [point.lng, point.lat]
  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Bounding box [minLng, minLat, maxLng, maxLat] for a set of coordinates.
 */
export function bbox(coords: [number, number][]): [number, number, number, number] {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
  for (const [lng, lat] of coords) {
    minLng = Math.min(minLng, lng)
    minLat = Math.min(minLat, lat)
    maxLng = Math.max(maxLng, lng)
    maxLat = Math.max(maxLat, lat)
  }
  return [minLng, minLat, maxLng, maxLat]
}
