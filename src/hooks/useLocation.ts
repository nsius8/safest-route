import { useState, useEffect, useCallback } from 'react'
import type { LatLng } from '../types'

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 5000, // allow short cache so watch updates reasonably often when moving
}

export function useLocation() {
  const [position, setPosition] = useState<LatLng | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setError(null)
        setLoading(false)
      },
      (err) => {
        setError(err.message)
        setLoading(false)
      },
      GEO_OPTIONS
    )
  }, [])

  // Initial fetch + watch for movement so position updates as the user moves
  useEffect(() => {
    if (!navigator.geolocation) {
      setError('Geolocation not supported')
      setLoading(false)
      return
    }
    let watchId: number | null = null
    const onPosition = (pos: GeolocationPosition) => {
      setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude })
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
