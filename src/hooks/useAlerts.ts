import { useState, useEffect, useCallback, useRef } from 'react'
import type { ActiveAlert, ActiveAlertResponse } from '../types'
import api from '../services/api'

/** Stable key for alert payload so we only bump alertUpdatedAt when zones would change */
function alertPayloadKey(data: ActiveAlertResponse | ActiveAlert | null): string {
  if (data == null || typeof data !== 'object') return 'none'
  if (data.type === 'none' || !(data.cities?.length ?? 0)) return 'none'
  const list = 'alerts' in data && Array.isArray(data.alerts) && data.alerts.length > 0 ? data.alerts : [data]
  return list
    .map((a) => `${a.type}:${[...(a.cities ?? [])].sort().join(',')}`)
    .sort()
    .join('|')
}

export function useAlerts() {
  const [alert, setAlert] = useState<ActiveAlert | null>(null)
  /** When active, list of alerts by type (for expandable banner and map colors) */
  const [alertsList, setAlertsList] = useState<ActiveAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [alertUpdatedAt, setAlertUpdatedAt] = useState(0)
  const sseRef = useRef<EventSource | null>(null)
  const lastPayloadKeyRef = useRef<string>('')

  const setAlertFromPayload = useCallback((data: ActiveAlertResponse | ActiveAlert | undefined | null) => {
    if (data == null || typeof data !== 'object') {
      setAlert(null)
      setAlertsList([])
      return
    }
    const hasAlert = data.type !== 'none' && (data.cities?.length ?? 0) > 0
    if (!hasAlert) {
      setAlert(null)
      setAlertsList([])
      return
    }
    setAlert(data)
    const list = 'alerts' in data && Array.isArray(data.alerts) && data.alerts.length > 0
      ? data.alerts
      : [data]
    setAlertsList(list)
  }, [])

  const fetchAlert = useCallback(async () => {
    try {
      const res = await api.get<ActiveAlertResponse>('/alerts/active')
      const data = res?.data ?? null
      const key = alertPayloadKey(data)
      if (key !== lastPayloadKeyRef.current) {
        lastPayloadKeyRef.current = key
        setAlertUpdatedAt(Date.now())
      }
      setAlertFromPayload(data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch alerts')
      if (lastPayloadKeyRef.current !== 'none') {
        lastPayloadKeyRef.current = 'none'
        setAlertUpdatedAt(Date.now())
      }
      setAlertFromPayload(null)
    } finally {
      setLoading(false)
    }
  }, [setAlertFromPayload])

  useEffect(() => {
    fetchAlert().catch(() => {})
    try {
      const es = new EventSource('/events/alerts')
      sseRef.current = es
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as ActiveAlertResponse | ActiveAlert
          const key = alertPayloadKey(data ?? null)
          if (key !== lastPayloadKeyRef.current) {
            lastPayloadKeyRef.current = key
            setAlertFromPayload(data)
            setAlertUpdatedAt(Date.now())
          }
        } catch (_) {}
      }
      es.onerror = () => {
        es.close()
        sseRef.current = null
      }
    } catch (_) {}
    const id = setInterval(() => {
      fetchAlert().catch(() => {})
    }, 10000)
    return () => {
      clearInterval(id)
      if (sseRef.current) {
        sseRef.current.close()
        sseRef.current = null
      }
    }
  }, [fetchAlert])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchAlert().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [fetchAlert])

  return { alert, alertsList, loading, error, refetch: fetchAlert, alertUpdatedAt }
}
