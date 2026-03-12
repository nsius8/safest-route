import { useState, useEffect, useRef } from 'react'
import { t } from '../i18n'
import type { ActiveAlert } from '../types'

/** Display label and color for map/banner by alert type */
export const ALERT_TYPE_STYLES: Record<string, { labelKey: string; color: string }> = {
  missiles: { labelKey: 'alertTypeMissiles', color: '#e74c3c' },
  hostileAircraftIntrusion: { labelKey: 'alertTypeHostileAircraft', color: '#e67e22' },
  general: { labelKey: 'alertTypeGeneral', color: '#f39c12' },
  newsFlash: { labelKey: 'alertTypeNewsFlash', color: '#9b59b6' },
}
const DEFAULT_ALERT_COLOR = '#c0392b'

function getAlertTypeStyle(type: string): { label: string; color: string } {
  const style = ALERT_TYPE_STYLES[type]
  if (style) {
    const label = t(style.labelKey)
    return { label: label !== style.labelKey ? label : type, color: style.color }
  }
  return { label: type, color: DEFAULT_ALERT_COLOR }
}

interface AlertBannerProps {
  alert: ActiveAlert | null
  /** When multiple types, list by type for expandable UI */
  alertsList?: ActiveAlert[]
  inDangerZone: boolean
  countdownSeconds: number | null
  currentLocationName: string | null
  onShowShelters: () => void
}

// Lazily-created, reusable AudioContext for alert beep
let _audioCtx: AudioContext | null = null
function getAudioContext(): AudioContext {
  if (_audioCtx && _audioCtx.state !== 'closed') return _audioCtx
  _audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
  return _audioCtx
}

// Minimal beep: use Web Audio for alert sound
function playAlertSound() {
  try {
    const ctx = getAudioContext()
    if (ctx.state === 'suspended') ctx.resume()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    gain.gain.value = 0.3
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.3)
  } catch (_) {}
}

export function AlertBanner({
  alert,
  alertsList = [],
  inDangerZone,
  countdownSeconds,
  currentLocationName,
  onShowShelters,
}: AlertBannerProps) {
  const [expanded, setExpanded] = useState(false)
  const playedRef = useRef(false)
  const list = alertsList.length > 0 ? alertsList : alert ? [alert] : []
  const multiType = list.length > 1

  useEffect(() => {
    if (alert && inDangerZone && !playedRef.current) {
      playAlertSound()
      playedRef.current = true
    }
    if (!alert) playedRef.current = false
  }, [alert, inDangerZone])

  if (!alert) return null

  const cities = alert.cities ?? []

  const titleSingle =
    cities.length === 0
      ? t('rocketAlert')
      : inDangerZone && currentLocationName
        ? cities.length <= 1
          ? currentLocationName
          : `${currentLocationName} + ${cities.length - 1} ${t('otherLocations')}`
        : cities.length < 5
          ? cities.join(', ')
          : currentLocationName
            ? `${currentLocationName} + ${cities.length - 1} ${t('otherLocations')}`
            : `${t('alertIn')} ${cities.length} ${t('locations')}`

  return (
    <div
      className={`alert-banner ${inDangerZone ? 'alert-banner--danger' : ''} ${multiType ? 'alert-banner--expandable' : ''}`}
      role="alert"
      aria-live="assertive"
    >
      <div className="alert-banner__content">
        {multiType ? (
          <>
            <button
              type="button"
              className="alert-banner__summary"
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
            >
              <span className="alert-banner__title">
                {t('alertTypesCount').replace('{{count}}', String(list.length))}
              </span>
              <span className="alert-banner__toggle" aria-hidden>
                {expanded ? '−' : '+'}
              </span>
            </button>
            {expanded && (
              <ul className="alert-banner__list">
                {list.map((a, i) => {
                  const { label, color } = getAlertTypeStyle(a.type)
                  const cityList = a.cities?.length < 5 ? a.cities.join(', ') : `${t('alertIn')} ${a.cities.length} ${t('locations')}`
                  return (
                    <li key={`${a.type}-${i}-${a.cities?.join(',') ?? ''}`} className="alert-banner__type" style={{ ['--alert-type-color' as string]: color }}>
                      <span className="alert-banner__type-pill" style={{ backgroundColor: color }} />
                      <span className="alert-banner__type-label">{label}:</span>{' '}
                      <span className="alert-banner__type-cities">{cityList}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        ) : (
          <h2 className="alert-banner__title">{titleSingle}</h2>
        )}
        {alert.instructions && !multiType && (
          <p className="alert-banner__instructions">{alert.instructions}</p>
        )}
        {alert.instructions && multiType && expanded && (
          <p className="alert-banner__instructions">{alert.instructions}</p>
        )}
        {countdownSeconds != null && countdownSeconds > 0 && (
          <p className="alert-banner__countdown">
            {t('timeToShelter')}: <strong>{countdownSeconds}</strong> s
          </p>
        )}
        {inDangerZone && (
          <button
            type="button"
            className="alert-banner__shelters"
            onClick={onShowShelters}
          >
            {t('showShelters')}
          </button>
        )}
      </div>
    </div>
  )
}
