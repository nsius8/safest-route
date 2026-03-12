import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../services/api'
import { t, getLang } from '../i18n'
import type { SafeRoute, LatLng, ZoneAlongRoute } from '../types'

interface PlaceSuggestion {
  label: string
  lat: number
  lng: number
}

interface RoutePanelProps {
  onRouteFound: (route: SafeRoute | null, from: LatLng | null, to: LatLng | null, zones?: ZoneAlongRoute[]) => void
  onUseMyLocation: (which: 'from' | 'to') => void
  onToggleZonesVisibility?: () => void
  myPosition: LatLng | null
  /** When set (e.g. after refetch by hour), overrides safety/alert risk for the selected route */
  liveRouteSafety?: { safetyScore: number; alertRiskInRoutePct: number } | null
}

export function RoutePanel({ onRouteFound, onUseMyLocation, onToggleZonesVisibility, myPosition, liveRouteSafety }: RoutePanelProps) {
  const [fromQuery, setFromQuery] = useState('')
  const [toQuery, setToQuery] = useState('')
  const [fromCoords, setFromCoords] = useState<LatLng | null>(null)
  const [toCoords, setToCoords] = useState<LatLng | null>(null)
  const [fromSuggestions, setFromSuggestions] = useState<PlaceSuggestion[]>([])
  const [toSuggestions, setToSuggestions] = useState<PlaceSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [alternatives, setAlternatives] = useState<SafeRoute[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const justPickedFromRef = useRef(false)
  const justPickedToRef = useRef(false)

  const fetchSuggestions = useCallback(async (q: string, setter: (s: PlaceSuggestion[]) => void) => {
    if (q.trim().length < 2) {
      setter([])
      return
    }
    try {
      const lang = getLang()
      const { data } = await api.get<{ suggestions: PlaceSuggestion[] }>('/cities/suggest', {
        params: { q: q.trim(), limit: 12, lang },
      })
      setter(data.suggestions || [])
    } catch (e) {
      console.error(e)
      setter([])
    }
  }, [])

  useEffect(() => {
    const id = setTimeout(() => {
      if (justPickedFromRef.current) {
        justPickedFromRef.current = false
        setFromSuggestions([])
        return
      }
      if (fromQuery.trim() && fromQuery !== t('useMyLocation')) {
        fetchSuggestions(fromQuery, setFromSuggestions)
      } else {
        setFromSuggestions([])
      }
    }, 200)
    return () => clearTimeout(id)
  }, [fromQuery, fetchSuggestions])

  useEffect(() => {
    const id = setTimeout(() => {
      if (justPickedToRef.current) {
        justPickedToRef.current = false
        setToSuggestions([])
        return
      }
      if (toQuery.trim() && toQuery !== t('useMyLocation')) {
        fetchSuggestions(toQuery, setToSuggestions)
      } else {
        setToSuggestions([])
      }
    }, 200)
    return () => clearTimeout(id)
  }, [toQuery, fetchSuggestions])

  const geocode = async (q: string): Promise<LatLng | null> => {
    const { data } = await api.get<{ lat: number | null; lng: number | null }>('/geocode', {
      params: { q: q.trim() },
    })
    if (data.lat != null && data.lng != null) return { lat: data.lat, lng: data.lng }
    return null
  }

  const handleUseMyLocation = (which: 'from' | 'to') => {
    if (which === 'from') {
      setFromQuery(t('useMyLocation'))
      setFromCoords(null)
      setFromSuggestions([])
    } else {
      setToQuery(t('useMyLocation'))
      setToCoords(null)
      setToSuggestions([])
    }
    onUseMyLocation(which)
  }

  const pickFromSuggestion = (s: PlaceSuggestion) => {
    justPickedFromRef.current = true
    setFromQuery(s.label)
    setFromCoords({ lat: s.lat, lng: s.lng })
    setFromSuggestions([])
  }

  const pickToSuggestion = (s: PlaceSuggestion) => {
    justPickedToRef.current = true
    setToQuery(s.label)
    setToCoords({ lat: s.lat, lng: s.lng })
    setToSuggestions([])
  }

  const handleFindRoute = async () => {
    setError(null)
    setLoading(true)
    onRouteFound(null, null, null)
    setFromSuggestions([])
    setToSuggestions([])

    try {
      let from: LatLng | null = fromCoords
      let to: LatLng | null = toCoords
      const fromTrim = fromQuery.trim()
      const toTrim = toQuery.trim()
      if (!from) {
        if (fromTrim && fromTrim !== t('useMyLocation')) from = await geocode(fromTrim)
        else if (myPosition) from = myPosition
      }
      if (!to) {
        if (toTrim && toTrim !== t('useMyLocation')) to = await geocode(toTrim)
        else if (myPosition) to = myPosition
      }

      if (!from || !to) {
        setError(`Please enter origin and destination, or use "${t('useMyLocation')}" for start.`)
        setLoading(false)
        return
      }

      const { data } = await api.post<{
        routes: SafeRoute[]
        from: LatLng
        to: LatLng
      }>('/route', { from, to })

      const routes = data.routes || []
      setAlternatives(routes)
      setSelectedIndex(0)
      if (routes.length > 0) {
        onRouteFound(routes[0], data.from, data.to, undefined)
        const coords = routes[0].segments?.[0]?.coordinates
        if (coords?.length) {
          api
            .post<{ safetyScore: number; alertRiskInRoutePct?: number; zonesAlongRoute: ZoneAlongRoute[] }>('/route/safety', {
              coordinates: coords,
              lang: getLang(),
            })
            .then(({ data: safetyData }) => {
              setAlternatives((prev) => {
                const updated = {
                  ...prev[0],
                  safetyScore: safetyData.safetyScore,
                  alertRiskInRoutePct: safetyData.alertRiskInRoutePct ?? Math.round(100 - safetyData.safetyScore),
                }
                onRouteFound(updated, data.from, data.to, safetyData.zonesAlongRoute)
                return prev.map((r, i) => (i === 0 ? updated : r))
              })
            })
            .catch(e => console.error(e))
        }
      } else {
        setError('No route found.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Route request failed')
      onRouteFound(null, null, null, undefined)
    } finally {
      setLoading(false)
    }
  }

  const selectAlternative = (index: number) => {
    if (index === selectedIndex && onToggleZonesVisibility) {
      onToggleZonesVisibility()
      return
    }
    setSelectedIndex(index)
    if (alternatives[index]) onRouteFound(alternatives[index], null, null, undefined)
  }

  const alertRiskPct = (r: SafeRoute, index: number) =>
    (index === selectedIndex && liveRouteSafety) ? liveRouteSafety.alertRiskInRoutePct : (r.alertRiskInRoutePct ?? Math.round(100 - r.safetyScore))
  /** Alert risk %: high = red, mid = orange, low = green */
  const riskClass = (alertRiskPct: number) => {
    if (alertRiskPct >= 80) return 'safety--low'
    if (alertRiskPct >= 50) return 'safety--mid'
    return 'safety--high'
  }

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60)
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`
  }
  const formatDistance = (m: number) => {
    if (m >= 1000) return `${(m / 1000).toFixed(1)} km`
    return `${Math.round(m)} m`
  }

  const LocationIcon = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  )

  return (
    <div className="route-panel">
      <div className="route-inputs">
        <div className="input-group">
          <div className="input-row">
            <label>{t('from')}</label>
            <input
              type="text"
              placeholder={t('placeholderAddress')}
              value={fromQuery}
              onChange={(e) => {
                setFromQuery(e.target.value)
                setFromCoords(null)
              }}
              aria-label="Origin"
              autoComplete="off"
            />
            <button
              type="button"
              className="btn-use-location"
              onClick={() => handleUseMyLocation('from')}
              title={t('useMyLocation')}
              aria-label={t('useMyLocation')}
            >
              <LocationIcon />
            </button>
          </div>
          {fromSuggestions.length > 0 && (
            <ul className="suggestions-list" role="listbox">
              {fromSuggestions.map((s, i) => (
                <li key={`${s.lat}-${s.lng}-${i}`}>
                  <button type="button" onClick={() => pickFromSuggestion(s)}>
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="input-group">
          <div className="input-row">
            <label>{t('to')}</label>
            <input
              type="text"
              placeholder={t('placeholderAddress')}
              value={toQuery}
              onChange={(e) => {
                setToQuery(e.target.value)
                setToCoords(null)
              }}
              aria-label="Destination"
              autoComplete="off"
            />
            <button
              type="button"
              className="btn-use-location"
              onClick={() => handleUseMyLocation('to')}
              title={t('useMyLocation')}
              aria-label={t('useMyLocation')}
            >
              <LocationIcon />
            </button>
          </div>
          {toSuggestions.length > 0 && (
            <ul className="suggestions-list" role="listbox">
              {toSuggestions.map((s, i) => (
                <li key={`${s.lat}-${s.lng}-${i}`}>
                  <button type="button" onClick={() => pickToSuggestion(s)}>
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <button
        type="button"
        className="btn-find-route"
        onClick={handleFindRoute}
        disabled={loading}
        aria-busy={loading}
      >
        {loading ? t('findingRoute') : t('findRoute')}
      </button>
      {error && <p className="route-error" role="alert">{error}</p>}

      {alternatives.length > 0 && (
        <div className="route-alternatives">
          <h3>{t('routeOptions')}</h3>
          {alternatives.map((r, i) => (
            <button
              key={i}
              type="button"
              className={`alternative ${i === selectedIndex ? 'selected' : ''}`}
              onClick={() => selectAlternative(i)}
            >
              <span className={`safety ${riskClass(alertRiskPct(r, i))}`}>{t('safety')}: {alertRiskPct(r, i)}%</span>
              <span className="summary">
                {formatDistance(r.summary.distance)} · {formatDuration(r.summary.duration)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
