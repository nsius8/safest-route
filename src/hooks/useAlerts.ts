import { useState, useEffect, useCallback, useRef } from 'react'
import type { ActiveAlert } from '../types'
import api from '../services/api'

export function useAlerts() {
  const [alert, setAlert] = useState<ActiveAlert | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const sseRef = useRef<EventSource | null>(null)

  const setAlertFromPayload = useCallback((data: ActiveAlert | undefined | null) => {
    if (data == null || typeof data !== 'object') {
      setAlert(null)
      return
    }
    const hasAlert = data.type !== 'none' && (data.cities?.length ?? 0) > 0
    setAlert(hasAlert ? data : null)
  }, [])

  const fetchAlert = useCallback(async () => {
    try {
      const res = await api.get<ActiveAlert>('/alerts/active')
      setAlertFromPayload(res?.data ?? null)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch alerts')
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
          const data = JSON.parse(e.data) as ActiveAlert
          setAlertFromPayload(data)
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
  }, [fetchAlert, setAlertFromPayload])

  return { alert, loading, error, refetch: fetchAlert }
}
