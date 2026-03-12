import { useState, useEffect, useCallback, useRef } from 'react'
import type { ActiveAlert, ActiveAlertResponse } from '../types'
import api from '../services/api'
import { alertPayloadKey } from '../utils/alertPayloadKey'

const SSE_MAX_RETRIES = 5
const SSE_MAX_BACKOFF = 30000

export function useAlerts() {
  const [alert, setAlert] = useState<ActiveAlert | null>(null)
  /** When active, list of alerts by type (for expandable banner and map colors) */
  const [alertsList, setAlertsList] = useState<ActiveAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [alertUpdatedAt, setAlertUpdatedAt] = useState(0)
  const sseRef = useRef<EventSource | null>(null)
  const lastPayloadKeyRef = useRef<string>('')
  const sseRetryCountRef = useRef(0)
  const sseRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

  const startPolling = useCallback(() => {
    if (pollingRef.current) return
    pollingRef.current = setInterval(() => {
      fetchAlert().catch(e => console.error(e))
    }, 10000)
  }, [fetchAlert])

  const connectSSE = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close()
      sseRef.current = null
    }
    try {
      const es = new EventSource('/events/alerts')
      sseRef.current = es
      es.onopen = () => {
        sseRetryCountRef.current = 0
      }
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
        const retryCount = sseRetryCountRef.current
        if (retryCount < SSE_MAX_RETRIES) {
          const backoff = Math.min(SSE_MAX_BACKOFF, 1000 * Math.pow(2, retryCount))
          sseRetryCountRef.current = retryCount + 1
          sseRetryTimerRef.current = setTimeout(() => {
            sseRetryTimerRef.current = null
            connectSSE()
          }, backoff)
        } else {
          // Max retries exceeded, fall back to polling only
          startPolling()
        }
      }
    } catch (_) {
      startPolling()
    }
  }, [setAlertFromPayload, startPolling])

  useEffect(() => {
    fetchAlert().catch(e => console.error(e))
    connectSSE()
    // Always poll as baseline, SSE provides faster updates
    startPolling()
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
      if (sseRetryTimerRef.current) {
        clearTimeout(sseRetryTimerRef.current)
        sseRetryTimerRef.current = null
      }
      if (sseRef.current) {
        sseRef.current.close()
        sseRef.current = null
      }
    }
  }, [fetchAlert, connectSSE, startPolling])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchAlert().catch(e => console.error(e))
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [fetchAlert])

  return { alert, alertsList, loading, error, refetch: fetchAlert, alertUpdatedAt }
}
