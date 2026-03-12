import { useState, useEffect, useCallback, useRef } from 'react'
import type { LatLng } from '../types'

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 5000, // allow short cache so watch updates reasonably often when moving
}

const POSITION_THRESHOLD = 0.0001 // ~10 meters

export function useLocation() {
  const [position, setPosition] = useState<LatLng | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const prevPosRef = useRef<LatLng | null>(null)

  const updatePosition = useCallback((lat: number, lng: number) => {
    const prev = prevPosRef.current
    if (prev && Math.abs(prev.lat - lat) < POSITION_THRESHOLD && Math.abs(prev.lng - lng) < POSITION_THRESHOLD) {
      return
    }
    const next = { lat, lng }
    prevPosRef.current = next
    setPosition(next)
  }, [])

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    if (!navigator.geolocation) {
      setError('Geolocation not supported')
      setLoading(false)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        updatePosition(pos.coords.latitude, pos.coords.longitude)
        setError(null)
        setLoading(false)
      },
      (err) => {
        setError(err.message)
        setLoading(false)
      },
      GEO_OPTIONS
    )
  }, [updatePosition])

  // Initial fetch + watch for movement so position updates as the user moves
  useEffect(() => {
    if (!navigator.geolocation) {
      setError('Geolocation not supported')
      setLoading(false)
      return
    }
    let watchId: number | null = null
    const onPosition = (pos: GeolocationPosition) => {
      updatePosition(pos.coords.latitude, pos.coords.longitude)
      setError(null)
      setLoading(false)
    }
    const onError = (err: GeolocationPositionError) => {
      setError(err.message)
      setLoading(false)
    }
    // Get initial position
    navigator.geolocation.getCurrentPosition(onPosition, onError, GEO_OPTIONS)
    // Keep updating when the user moves
    watchId = navigator.geolocation.watchPosition(onPosition, onError, GEO_OPTIONS)
    return () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId)
    }
  }, [])

  return { position, loading, error, refresh }
}
