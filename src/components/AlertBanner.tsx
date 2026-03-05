import { useEffect, useRef } from 'react'
import { t } from '../i18n'
import type { ActiveAlert } from '../types'

interface AlertBannerProps {
  alert: ActiveAlert | null
  inDangerZone: boolean
  countdownSeconds: number | null
  currentLocationName: string | null
  onShowShelters: () => void
}

// Minimal beep: use Web Audio for alert sound
function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
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

export function AlertBanner({ alert, inDangerZone, countdownSeconds, currentLocationName, onShowShelters }: AlertBannerProps) {
  const playedRef = useRef(false)

  useEffect(() => {
    if (alert && inDangerZone && !playedRef.current) {
      playAlertSound()
      playedRef.current = true
    }
    if (!alert) playedRef.current = false
  }, [alert, inDangerZone])

  if (!alert) return null

  const cities = alert.cities ?? []
  const title =
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
      className={`alert-banner ${inDangerZone ? 'alert-banner--danger' : ''}`}
      role="alert"
      aria-live="assertive"
    >
      <div className="alert-banner__content">
        <h2 className="alert-banner__title">{title}</h2>
        {alert.instructions && (
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
