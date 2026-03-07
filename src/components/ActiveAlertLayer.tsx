import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import api from '../services/api'

interface GeoJSONFeature {
  type: 'Feature'
  properties?: Record<string, unknown>
  geometry: { type: 'Polygon'; coordinates: [number, number][][] }
}

interface GeoJSONFC {
  type: 'FeatureCollection'
  features: GeoJSONFeature[]
}

/** Point-in-polygon: ring is [lng, lat][]. */
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

/** True if any route point is inside the feature polygon or polygon is near the route. */
function isFeatureNearRoute(feature: GeoJSONFeature, routeCoords: number[][]): boolean {
  const ring = feature?.geometry?.coordinates?.[0] as [number, number][] | undefined
  if (!ring?.length || !routeCoords?.length) return false
  for (const c of routeCoords) {
    const lng = c[0]
    const lat = c[1]
    if (Number.isFinite(lat) && Number.isFinite(lng) && pointInRing(lat, lng, ring)) return true
  }
  return false
}

export function ActiveAlertLayer({ active, routeCoordinates, lang = 'he', alertUpdatedAt = 0 }: { active: boolean; routeCoordinates?: number[][]; lang?: 'he' | 'en'; alertUpdatedAt?: number }) {
  const map = useMap()
  const layerRef = useRef<L.GeoJSON | null>(null)

  useEffect(() => {
    if (!active) {
      if (layerRef.current) {
        layerRef.current.remove()
        layerRef.current = null
      }
      return
    }

    let cancelled = false
    api.get<GeoJSONFC>('/alerts/active-zones', { params: { lang } }).then(({ data }) => {
      if (cancelled || !data?.features?.length) return
      if (layerRef.current) {
        layerRef.current.remove()
        layerRef.current = null
      }
      const routeCoords = routeCoordinates ?? []
      const geo = L.geoJSON(data as GeoJSONFC, {
        style: (feature) => {
          const near = feature && isFeatureNearRoute(feature as GeoJSONFeature, routeCoords)
          return {
            color: '#e74c3c',
            fillColor: '#e74c3c',
            fillOpacity: 0.35,
            weight: 2,
            className: near ? 'alert-zone-blink' : '',
          }
        },
        onEachFeature: (feature, layer) => {
          const name = feature?.properties?.name
          if (name != null && name !== '') {
            layer.bindTooltip(String(name), { permanent: false, direction: 'top' })
            layer.bindPopup(String(name))
          }
        },
      })
      geo.addTo(map)
      layerRef.current = geo
    }).catch(() => {})

    return () => {
      cancelled = true
      if (layerRef.current) {
        layerRef.current.remove()
        layerRef.current = null
      }
    }
  }, [map, active, routeCoordinates, lang, alertUpdatedAt])

  return null
}
