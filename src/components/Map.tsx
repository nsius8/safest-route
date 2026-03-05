import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { HeatmapLayer } from './HeatmapLayer'
import { ActiveAlertLayer } from './ActiveAlertLayer'
import type { SafeRoute, Shelter, LatLng, ZoneAlongRoute } from '../types'

const ISRAEL_CENTER: [number, number] = [31.77, 35.21]
const DEFAULT_ZOOM = 8

function RouteLayer({ route }: { route: SafeRoute | null }) {
  const map = useMap()
  const layerRef = useRef<L.Polyline | null>(null)

  useEffect(() => {
    if (!route?.segments?.length) {
      if (layerRef.current) {
        layerRef.current.remove()
        layerRef.current = null
      }
      return
    }
    const latlngs: L.LatLngExpression[] = route.segments.flatMap((s) =>
      (s.coordinates || []).map(([lng, lat]) => [lat, lng] as [number, number])
    )
    if (layerRef.current) layerRef.current.remove()
    const poly = L.polyline(latlngs, { color: '#3498db', weight: 5 })
    poly.addTo(map)
    layerRef.current = poly
    map.fitBounds(poly.getBounds(), { padding: [40, 40] })
    return () => {
      if (layerRef.current) {
        layerRef.current.remove()
        layerRef.current = null
      }
    }
  }, [map, route])

  return null
}

function ShelterMarkersLayer({ shelters }: { shelters: Shelter[] }) {
  const map = useMap()
  const markersRef = useRef<L.Marker[]>([])

  useEffect(() => {
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []
    shelters.forEach((s, i) => {
      const m = L.marker([s.lat, s.lon], {
        icon: L.divIcon({
          className: 'shelter-marker',
          html: `<div style="background:#2ecc71;width:24px;height:24px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        }),
      })
      m.bindTooltip(s.name || `Shelter ${i + 1}`, { permanent: false })
      m.addTo(map)
      markersRef.current.push(m)
    })
    return () => {
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
    }
  }, [map, shelters])

  return null
}

function ZoneAlongRouteLayer({ zones }: { zones: ZoneAlongRoute[] }) {
  const map = useMap()
  const layerRef = useRef<L.Polygon[]>([])
  const labelRef = useRef<L.Marker[]>([])

  useEffect(() => {
    layerRef.current.forEach((p) => p.remove())
    layerRef.current = []
    labelRef.current.forEach((m) => m.remove())
    labelRef.current = []
    if (!zones.length) return
    const maxScore = Math.max(1, ...zones.map((z) => z.score))
    zones.forEach((z) => {
      const ring = z.coordinates
      if (!ring?.length) return
      const latlngs: L.LatLngExpression[] = ring.map(([lng, lat]) => [lat, lng] as [number, number])
      const ratio = maxScore > 0 ? z.score / maxScore : 0
      const fillColor = ratio > 0.5 ? '#c0392b' : ratio > 0.2 ? '#f39c12' : '#27ae60'
      const poly = L.polygon(latlngs, {
        color: fillColor,
        weight: 2,
        fillColor,
        fillOpacity: 0.15,
      })
      const scorePct = z.score <= 1 ? `${(z.score * 100).toFixed(0)}%` : String(z.score)
      const label = z.name ? `${z.name} (${scorePct})` : scorePct
      poly.bindTooltip(label, { permanent: false, direction: 'top' })
      poly.addTo(map)
      layerRef.current.push(poly)
    })
    return () => {
      layerRef.current.forEach((p) => p.remove())
      layerRef.current = []
      labelRef.current.forEach((m) => m.remove())
      labelRef.current = []
    }
  }, [map, zones])

  return null
}

const PERSON_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>'

function UserLocationLayer({ position }: { position: LatLng | null }) {
  const map = useMap()
  const markerRef = useRef<L.Marker | null>(null)

  useEffect(() => {
    if (markerRef.current) {
      markerRef.current.remove()
      markerRef.current = null
    }
    if (!position) return
    const m = L.marker([position.lat, position.lng], {
      icon: L.divIcon({
        className: 'user-location-marker',
        html: `<div class="user-pin user-pin--icon">${PERSON_ICON_SVG}</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      }),
    })
    m.addTo(map)
    markerRef.current = m
    return () => {
      if (markerRef.current) {
        markerRef.current.remove()
        markerRef.current = null
      }
    }
  }, [map, position])

  return null
}

type Lang = 'he' | 'en'

interface MapProps {
  activeAlert: boolean
  route: SafeRoute | null
  shelters: Shelter[]
  zonesAlongRoute: ZoneAlongRoute[]
  userPosition: LatLng | null
  showHeatmap?: boolean
  lang?: Lang
  children?: React.ReactNode
}

export function Map({ activeAlert, route, shelters, zonesAlongRoute, userPosition, showHeatmap = false, lang = 'he', children }: MapProps) {
  return (
    <div className="map-wrapper">
      <MapContainer
        center={ISRAEL_CENTER}
        zoom={DEFAULT_ZOOM}
        className="map-container"
        zoomControl={true}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {showHeatmap && <HeatmapLayer />}
        <ActiveAlertLayer
          active={activeAlert}
          routeCoordinates={route?.segments?.[0]?.coordinates}
          lang={lang}
        />
        <RouteLayer route={route} />
        {zonesAlongRoute.length > 0 && <ZoneAlongRouteLayer zones={zonesAlongRoute} />}
        <UserLocationLayer position={userPosition} />
        {shelters.length > 0 && <ShelterMarkersLayer shelters={shelters} />}
        {children}
      </MapContainer>
    </div>
  )
}
