import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import api from '../services/api'
import { ALERT_TYPE_STYLES } from './AlertBanner'

const DEFAULT_ZONE_COLOR = '#e74c3c'

function getColorForAlertType(alertType: string | undefined): string {
  if (!alertType) return DEFAULT_ZONE_COLOR
  return ALERT_TYPE_STYLES[alertType]?.color ?? DEFAULT_ZONE_COLOR
}

interface GeoJSONFeature {
  type: 'Feature'
  properties?: Record<string, unknown> & { alertType?: string }
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
  const prevDataRef = useRef<string>('')

  useEffect(() => {
    if (!active) {
      if (layerRef.current) {
        layerRef.current.remove()
        layerRef.current = null
      }
      prevDataRef.current = ''
      return
    }

    let cancelled = false
    api.get<GeoJSONFC>('/alerts/active-zones', { params: { lang } }).then(({ data }) => {
      if (cancelled) return
      const dataKey = data?.features?.length ? JSON.stringify(data.features.map(f => f.properties?.name).sort()) : ''

      if (!data?.features?.length) {
        if (layerRef.current) {
          layerRef.current.remove()
          layerRef.current = null
        }
        prevDataRef.current = ''
        return
      }

      // Skip re-render if zones haven't changed
      if (dataKey === prevDataRef.current && layerRef.current) return
      prevDataRef.current = dataKey

      if (layerRef.current) {
        layerRef.current.remove()
        layerRef.current = null
      }
      const routeCoords = routeCoordinates ?? []
      const geo = L.geoJSON(data as GeoJSONFC, {
        style: (feature) => {
          const f = feature as GeoJSONFeature
          const near = f && isFeatureNearRoute(f, routeCoords)
          const color = getColorForAlertType(f?.properties?.alertType)
          return {
            color,
            fillColor: color,
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
    }).catch(e => console.error(e))

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
