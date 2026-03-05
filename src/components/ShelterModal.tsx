import { useEffect, useState } from 'react'
import api from '../services/api'
import { t } from '../i18n'
import type { Shelter } from '../types'
import type { LatLng } from '../types'

interface ShelterModalProps {
  open: boolean
  position: LatLng | null
  onClose: () => void
  onSheltersLoaded: (shelters: Shelter[]) => void
}

export function ShelterModal({
  open,
  position,
  onClose,
  onSheltersLoaded,
}: ShelterModalProps) {
  const [shelters, setShelters] = useState<Shelter[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !position) {
      setShelters([])
      return
    }
    setLoading(true)
    api
      .get<{ shelters: Array<{ id: string; lat: number; lon: number; name?: string; distance: number }> }>(
        '/shelters/nearby',
        { params: { lat: position.lat, lon: position.lng, radius: 2000 } }
      )
      .then(({ data }) => {
        const list = (data.shelters || []).map((s) => ({
          ...s,
          distance: s.distance,
        }))
        setShelters(list)
        onSheltersLoaded(list)
      })
      .catch(() => setShelters([]))
      .finally(() => setLoading(false))
  }, [open, position, onSheltersLoaded])

  const formatDistance = (m: number) => {
    if (m >= 1000) return `${(m / 1000).toFixed(1)} km`
    return `${Math.round(m)} m`
  }

  if (!open) return null

  return (
    <div className="shelter-modal-overlay" role="dialog" aria-modal="true" aria-label="Nearest shelters">
      <div className="shelter-modal">
        <div className="shelter-modal__header">
          <h2>{t('nearestShelters')}</h2>
          <button type="button" className="shelter-modal__close" onClick={onClose} aria-label={t('close')}>
            ×
          </button>
        </div>
        {loading ? (
          <p className="shelter-modal__loading">{t('loading')}</p>
        ) : shelters.length === 0 ? (
          <p className="shelter-modal__empty">{t('noShelters')}</p>
        ) : (
          <ul className="shelter-modal__list">
            {shelters.map((s) => (
              <li key={s.id}>
                <span className="shelter-name">{s.name || t('legendShelter')}</span>
                <span className="shelter-distance">{formatDistance(s.distance ?? 0)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
