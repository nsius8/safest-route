import type { ActiveAlert, ActiveAlertResponse } from '../types'

/** Stable key for alert payload so we only bump alertUpdatedAt when zones would change */
export function alertPayloadKey(data: ActiveAlertResponse | ActiveAlert | null): string {
  if (data == null || typeof data !== 'object') return 'none'
  if (data.type === 'none' || !(data.cities?.length ?? 0)) return 'none'
  const list = 'alerts' in data && Array.isArray(data.alerts) && data.alerts.length > 0 ? data.alerts : [data]
  return list
    .map((a) => `${a.type}:${[...(a.cities ?? [])].sort().join(',')}`)
    .sort()
    .join('|')
}
