import { useState, useEffect, useCallback, useRef } from 'react'
import { Map } from './components/Map'
import api from './services/api'
import { RoutePanel } from './components/RoutePanel'
import { AlertBanner } from './components/AlertBanner'
import { ShelterModal } from './components/ShelterModal'
import { Legend } from './components/Legend'
import { useAlerts } from './hooks/useAlerts'
import { useLocation } from './hooks/useLocation'
import { t, setLang as setLangGlobal, getLang, type Lang } from './i18n'
import type { SafeRoute, Shelter, LatLng, ZoneAlongRoute } from './types'

const COUNTDOWN_DEFAULT = 90

/** Round "HH:mm" to nearest half-hour (:00 or :30). */
function roundToHalfHour(time: string): string {
  const [h, m] = time.split(':').map((s) => parseInt(s, 10))
  if (Number.isNaN(h) || Number.isNaN(m)) return time
  const totalMins = h * 60 + m
  const rounded = Math.round(totalMins / 30) * 30
  const hours = Math.floor(rounded / 60) % 24
  const mins = rounded % 60
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`
}

/** Convert "HH:mm" (assumed :00 or :30) to half-hour slot 0-47. */
function timeToSlot(time: string): number {
  const [h, m] = time.split(':').map((s) => parseInt(s, 10))
  if (Number.isNaN(h)) return 0
  const minute = Number.isNaN(m) ? 0 : m
  return Math.min(47, Math.max(0, h * 2 + (minute >= 30 ? 1 : 0)))
}

function App() {
  const [lang, setLangState] = useState<Lang>('he')
  const { alert } = useAlerts()
  const { position: myPosition, refresh: refreshLocation } = useLocation()

  const setLang = useCallback((l: Lang) => {
    setLangGlobal(l)
    setLangState(l)
  }, [])

  useEffect(() => {
    setLangGlobal(lang)
  }, [lang])

  // Load alert history on site load and when language changes (drives heatmap + zone scores)
  useEffect(() => {
    const historyLang = getLang() === 'he' ? 'he' : 'en'
    api.get('/alerts/history', { params: { lang: historyLang } }).catch(() => {})
  }, [lang])

  const [showSheltersOnMap, setShowSheltersOnMap] = useState(false)
  const [scoreMode, setScoreMode] = useState<'overall' | 'byTime'>('byTime')
  const [selectedTime, setSelectedTime] = useState(() => {
    const d = new Date()
    const t = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    return roundToHalfHour(t)
  })
  const [route, setRoute] = useState<SafeRoute | null>(null)
  const [zonesAlongRoute, setZonesAlongRoute] = useState<ZoneAlongRoute[]>([])
  const [routeSafety, setRouteSafety] = useState<{ safetyScore: number; alertRiskInRoutePct: number } | null>(null)
  const [zonesVisible, setZonesVisible] = useState(true)
  const [routeShelters, setRouteShelters] = useState<Shelter[]>([])
  const [shelters, setShelters] = useState<Shelter[]>([])
  const [shelterModalOpen, setShelterModalOpen] = useState(false)
  const [mobilePanelExpanded, setMobilePanelExpanded] = useState(true)
  const [inDangerZone, setInDangerZone] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [zoneLocationName, setZoneLocationName] = useState<string | null>(null)
  const [zoneLocationNameEn, setZoneLocationNameEn] = useState<string | null>(null)
  const countdownEndsAtRef = useRef<number | null>(null)
  /** Once countdown reaches 0, don't restart for the same stay-in-zone; reset when user leaves zone or alert clears. */
  const countdownAlreadyCompletedRef = useRef(false)
  const drawerTouchStartY = useRef<number | null>(null)
  const drawerSwipeHandled = useRef(false)

  // Refetch safety + zones when language, route, score mode or (when by-time) selected time changes
  useEffect(() => {
    const coords = route?.segments?.[0]?.coordinates
    if (!coords?.length) {
      setRouteSafety(null)
      return
    }
    const body: { coordinates: number[][]; lang: string; slot?: number } = {
      coordinates: coords,
      lang: getLang(),
    }
    if (scoreMode === 'byTime') {
      body.slot = timeToSlot(selectedTime)
    }
    api
      .post<{ safetyScore: number; alertRiskInRoutePct?: number; zonesAlongRoute: ZoneAlongRoute[] }>('/route/safety', body)
      .then(({ data }) => {
        setZonesAlongRoute(data.zonesAlongRoute ?? [])
        setRouteSafety({
          safetyScore: data.safetyScore,
          alertRiskInRoutePct: data.alertRiskInRoutePct ?? Math.round(100 - data.safetyScore),
        })
      })
      .catch(() => setRouteSafety(null))
  }, [lang, route?.segments, scoreMode, selectedTime])

  const handleRouteFound = useCallback(
    (r: SafeRoute | null, _from: LatLng | null, _to: LatLng | null, zones?: ZoneAlongRoute[]) => {
      setRoute(r)
      setZonesAlongRoute(zones ?? [])
      setZonesVisible(true)
      if (!r) {
        setRouteShelters([])
        setRouteSafety(null)
      }
    },
    []
  )

  const toggleZonesVisibility = useCallback(() => {
    setZonesVisible((v) => !v)
  }, [])

  const handleUseMyLocation = useCallback(
    (_which: 'from' | 'to') => {
      refreshLocation()
    },
    [refreshLocation]
  )

  useEffect(() => {
    if (!alert || !myPosition) {
      setInDangerZone(false)
      setCountdown(null)
      setZoneLocationName(null)
      setZoneLocationNameEn(null)
      countdownEndsAtRef.current = null
      countdownAlreadyCompletedRef.current = false
      return
    }
    api
      .get<{ inZone: boolean; countdown?: number; locationName?: string; locationNameEn?: string }>('/alerts/in-zone', {
        params: { lat: myPosition.lat, lng: myPosition.lng },
      })
      .then(({ data }) => {
        setInDangerZone(data.inZone)
        setZoneLocationName(data.locationName ?? null)
        setZoneLocationNameEn(data.locationNameEn ?? null)
        if (!data.inZone) {
          countdownEndsAtRef.current = null
          setCountdown(null)
          countdownAlreadyCompletedRef.current = false
          return
        }
        const showCountdown =
          (alert.type === 'missiles' || alert.type === 'hostileAircraftIntrusion') &&
          typeof data.countdown === 'number' &&
          data.countdown > 0
        if (showCountdown && !countdownAlreadyCompletedRef.current) {
          const countdownSec = data.countdown ?? COUNTDOWN_DEFAULT
          if (countdownEndsAtRef.current == null || countdownEndsAtRef.current < Date.now()) {
            countdownEndsAtRef.current = Date.now() + countdownSec * 1000
            setCountdown(countdownSec)
          }
        } else if (!showCountdown) {
          countdownEndsAtRef.current = null
          setCountdown(null)
        }
      })
      .catch(() => {
        setInDangerZone(false)
        setCountdown(null)
        setZoneLocationName(null)
        setZoneLocationNameEn(null)
        countdownEndsAtRef.current = null
        countdownAlreadyCompletedRef.current = false
      })
  }, [alert, myPosition])

  useEffect(() => {
    if (countdownEndsAtRef.current == null) return
    const tick = () => {
      const now = Date.now()
      if (countdownEndsAtRef.current == null || now >= countdownEndsAtRef.current) {
        if (countdownEndsAtRef.current != null && now >= countdownEndsAtRef.current) {
          countdownAlreadyCompletedRef.current = true
        }
        setCountdown(null)
        countdownEndsAtRef.current = null
        return
      }
      setCountdown(Math.ceil((countdownEndsAtRef.current - now) / 1000))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [inDangerZone, alert])

  const showShelters = useCallback(() => {
    setShelterModalOpen(true)
  }, [])

  const onSheltersLoaded = useCallback((list: Shelter[]) => {
    setShelters(list)
  }, [])

  // When "show nearby shelters" is on, fetch and show shelters on map; when off, clear them
  useEffect(() => {
    if (!showSheltersOnMap) {
      setShelters([])
      return
    }
    if (!myPosition) return
    api
      .get<{ shelters: Array<{ id: string; lat: number; lon: number; name?: string; distance: number }> }>(
        '/shelters/nearby',
        { params: { lat: myPosition.lat, lon: myPosition.lng, radius: 2000 } }
      )
      .then(({ data }) => {
        setShelters(
          (data.shelters || []).map((s) => ({
            id: s.id,
            lat: s.lat,
            lon: s.lon,
            name: s.name,
            distance: s.distance,
          }))
        )
      })
      .catch(() => setShelters([]))
  }, [showSheltersOnMap, myPosition?.lat, myPosition?.lng])

  useEffect(() => {
    if (!route?.segments?.[0]?.coordinates?.length) {
      setRouteShelters([])
      return
    }
    api
      .post<{ shelters: Array<{ id: string; lat: number; lon: number; name?: string; distance: number }> }>(
        '/shelters/along-route',
        { coordinates: route.segments[0].coordinates }
      )
      .then(({ data }) => {
        setRouteShelters(
          (data.shelters || []).map((s) => ({
            id: s.id,
            lat: s.lat,
            lon: s.lon,
            name: s.name,
            distance: s.distance,
          }))
        )
      })
      .catch(() => setRouteShelters([]))
  }, [route])

  return (
    <div className="app">
      <div className="app__map-wrap">
        <Map
          activeAlert={!!alert}
          route={route}
          shelters={route ? routeShelters : shelters}
          zonesAlongRoute={zonesVisible ? zonesAlongRoute : []}
          userPosition={myPosition}
          showHeatmap={false}
          lang={lang}
        />
      </div>
      <header className="app__header">
        <h1 className="app__title">{t('appTitle')}</h1>
        <div className="app__lang">
          <button
            type="button"
            className={lang === 'he' ? '' : 'active'}
            onClick={() => setLang('en')}
            aria-pressed={lang === 'en'}
            aria-label="English"
          >
            EN
          </button>
          <button
            type="button"
            className={lang === 'he' ? 'active' : ''}
            onClick={() => setLang('he')}
            aria-pressed={lang === 'he'}
            aria-label="עברית"
          >
            עברית
          </button>
        </div>
      </header>
      <div id="zoom-control-mount" className="app__zoom-wrap" />
      <div className="app__alert-wrap">
        <AlertBanner
          alert={alert}
          inDangerZone={inDangerZone}
          countdownSeconds={countdown}
          currentLocationName={lang === 'he' ? zoneLocationName : (zoneLocationNameEn || zoneLocationName)}
          onShowShelters={showShelters}
        />
      </div>
      <div className={`app__panel ${!mobilePanelExpanded ? 'app__panel--collapsed' : ''}`}>
        <button
          type="button"
          className="app__panel-handle"
          onClick={() => {
            if (drawerSwipeHandled.current) {
              drawerSwipeHandled.current = false
              return
            }
            setMobilePanelExpanded((v) => !v)
          }}
          onTouchStart={(e) => {
            drawerTouchStartY.current = e.touches[0].clientY
          }}
          onTouchEnd={(e) => {
            const startY = drawerTouchStartY.current
            drawerTouchStartY.current = null
            if (startY == null) return
            const endY = e.changedTouches[0].clientY
            const dy = endY - startY
            const threshold = 50
            if (dy > threshold) {
              setMobilePanelExpanded(false)
              drawerSwipeHandled.current = true
            } else if (dy < -threshold) {
              setMobilePanelExpanded(true)
              drawerSwipeHandled.current = true
            }
          }}
          aria-expanded={mobilePanelExpanded}
          aria-label={mobilePanelExpanded ? t('panelCollapse') : t('panelExpand')}
        >
          <span className="app__panel-handle-bar" aria-hidden />
          <span className="app__panel-handle-icon" aria-hidden>
            {mobilePanelExpanded ? '⌄' : '⌃'}
          </span>
        </button>
        <RoutePanel
          onRouteFound={handleRouteFound}
          onUseMyLocation={handleUseMyLocation}
          onToggleZonesVisibility={toggleZonesVisibility}
          myPosition={myPosition}
          liveRouteSafety={routeSafety}
        />
        <div className="score-mode">
          <span className="score-mode__label">{t('zoneScore')}</span>
          <div className="score-mode__toggle" role="group" aria-label={t('zoneScore')}>
            <button
              type="button"
              className={scoreMode === 'overall' ? 'active' : ''}
              onClick={() => setScoreMode('overall')}
              aria-pressed={scoreMode === 'overall'}
            >
              {t('scoreOverall')}
            </button>
            <button
              type="button"
              className={scoreMode === 'byTime' ? 'active' : ''}
              onClick={() => setScoreMode('byTime')}
              aria-pressed={scoreMode === 'byTime'}
            >
              {t('scoreByTime')}
            </button>
          </div>
          {scoreMode === 'byTime' && (
            <label className="score-mode__time">
              <input
                type="time"
                value={selectedTime}
                onChange={(e) => setSelectedTime(roundToHalfHour(e.target.value))}
                step={1800}
                aria-label={t('scoreTimeLabel')}
              />
            </label>
          )}
        </div>
        <Legend showSheltersOnMap={showSheltersOnMap} onToggleShowShelters={() => setShowSheltersOnMap((v) => !v)} />
      </div>
      <ShelterModal
        open={shelterModalOpen}
        position={myPosition}
        onClose={() => setShelterModalOpen(false)}
        onSheltersLoaded={onSheltersLoaded}
      />
    </div>
  )
}

export default App
