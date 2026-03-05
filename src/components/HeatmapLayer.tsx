import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import api from '../services/api'

interface HeatmapPoint {
  lat: number
  lng: number
  weight: number
}

export function HeatmapLayer() {
  const map = useMap()
  const layerRef = useRef<L.Circle[]>([])

  useEffect(() => {
    let cancelled = false
    api.get<{ points: HeatmapPoint[] }>('/alerts/heatmap').then(({ data }) => {
      if (cancelled) return
      const list = data.points || []
      const maxWeight = Math.max(1, ...list.map((p) => p.weight))
      list.forEach((p) => {
        const radius = 800 + (p.weight / maxWeight) * 4000
        const opacity = 0.15 + 0.25 * (p.weight / maxWeight)
        const circle = L.circle([p.lat, p.lng], {
          radius,
          fillColor: p.weight > maxWeight * 0.5 ? '#c0392b' : p.weight > maxWeight * 0.2 ? '#f39c12' : '#27ae60',
          color: 'transparent',
          fillOpacity: opacity,
          weight: 0,
        })
        circle.addTo(map)
        layerRef.current.push(circle)
      })
    }).catch(() => {})

    return () => {
      cancelled = true
      layerRef.current.forEach((c) => c.remove())
      layerRef.current = []
    }
  }, [map])

  return null
}
