/**
 * Alert service: polls OREF live API, caches alert history, exposes state for REST/SSE.
 */
import axios from 'axios'

const OREF_HISTORY_URL = 'https://alerts-history.oref.org.il/Shared/Ajax/GetAlarmsHistory.aspx'
const HISTORY_MODE = 2
const POLL_INTERVAL_MS = 3000
const HISTORY_CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes
const ALERT_WINDOW_MS = 10 * 60 * 1000 // 10 minutes: keep pushes in this window; active = union of cities in window

/** Lang for OREF history API: 'he' | 'en' */
export type HistoryLang = 'he' | 'en'

export interface ActiveAlertPayload {
  type: string
  cities: string[]
  instructions?: string
}

export interface AlertHistoryEntryPayload {
  data: string
  date?: string
  time?: string
  datetime?: string
  type?: string
  alertType?: string
}

export interface AlertHistoryResponse {
  history?: AlertHistoryEntryPayload[]
  data?: AlertHistoryEntryPayload[]
  Alarms?: AlertHistoryEntryPayload[]
}

/** Include entry if it has no type (API may not send it) or if type indicates missile. */
function isMissileAlert(entry: AlertHistoryEntryPayload): boolean {
  const t = (entry.type || entry.alertType || '').trim()
  if (!t) return true
  const lower = t.toLowerCase()
  return lower.includes('missile') || lower === 'missiles' || t.includes('טילים')
}

/** Stored push: each POST /api/alerts/push is appended with receivedAt; pruned when older than ALERT_WINDOW_MS. */
interface StoredPush {
  type: string
  cities: string[]
  instructions?: string
  receivedAt: number
}

let alertPushLog: StoredPush[] = []
let alertListeners: ((alert: ActiveAlertPayload | null) => void)[] = []

// Dynamic import for CommonJS package (pikud-haoref-api)
async function getPikudHaoref() {
  const mod = await import('pikud-haoref-api')
  return mod.default ?? mod
}

function pruneOldPushes(): void {
  const cutoff = Date.now() - ALERT_WINDOW_MS
  alertPushLog = alertPushLog.filter((p) => p.receivedAt >= cutoff)
}

/** Per-city latest mention: type and receivedAt from the most recent push that mentioned that city. */
interface CityLatest {
  type: string
  receivedAt: number
  instructions?: string
}

/**
 * Derive active alerts from pushes in the last ALERT_WINDOW_MS.
 * - For each city we use the *most recent* push that mentioned it. If that push has type 'none', the city is cleared (excluded).
 * - Supports multiple types in parallel: cities are grouped by that latest type.
 */
function getDerivedActiveAlerts(): ActiveAlertPayload[] {
  pruneOldPushes()
  if (alertPushLog.length === 0) return []
  const byReceivedAsc = [...alertPushLog].sort((a, b) => a.receivedAt - b.receivedAt)
  const cityLatest = new Map<string, CityLatest>()
  for (const p of byReceivedAsc) {
    if (!p.cities?.length) continue
    for (const c of p.cities) {
      cityLatest.set(c, { type: p.type, receivedAt: p.receivedAt, instructions: p.instructions })
    }
  }
  const typeToCities = new Map<string, Set<string>>()
  const typeToInstructions = new Map<string, string | undefined>()
  for (const [city, cl] of cityLatest) {
    if (cl.type === 'none') continue
    if (!typeToCities.has(cl.type)) {
      typeToCities.set(cl.type, new Set())
      typeToInstructions.set(cl.type, cl.instructions)
    }
    typeToCities.get(cl.type)!.add(city)
  }
  const alerts: ActiveAlertPayload[] = []
  for (const [type, cities] of typeToCities) {
    if (cities.size === 0) continue
    alerts.push({
      type,
      cities: [...cities],
      instructions: typeToInstructions.get(type),
    })
  }
  return alerts
}

/** Single merged view for backward compat: all cities from all types; type is first type or 'multiple'. */
export function getActiveAlertSync(): ActiveAlertPayload | null {
  const alerts = getDerivedActiveAlerts()
  if (alerts.length === 0) return null
  const allCities = new Set<string>()
  let instructions: string | undefined
  for (const a of alerts) {
    for (const c of a.cities) allCities.add(c)
    if (instructions == null) instructions = a.instructions
  }
  const type = alerts.length === 1 ? alerts[0].type : 'multiple'
  return { type, cities: [...allCities], instructions }
}

/** Full list of active alerts by type (for multiple types in parallel, e.g. drone + missile). */
export function getActiveAlertsSync(): ActiveAlertPayload[] {
  return getDerivedActiveAlerts()
}

/** Same as getActiveAlertSync; includes alerts[] only when there are 2+ types (no duplication for single type). */
export function getActiveAlertWithListSync(): (ActiveAlertPayload & { alerts?: ActiveAlertPayload[] }) | null {
  const merged = getActiveAlertSync()
  if (!merged) return null
  const list = getActiveAlertsSync()
  if (list.length > 1) return { ...merged, alerts: list }
  return merged
}

export function subscribeToAlerts(listener: (alert: (ActiveAlertPayload & { alerts?: ActiveAlertPayload[] }) | null) => void): () => void {
  alertListeners.push(listener as (alert: ActiveAlertPayload | null) => void)
  listener(getActiveAlertWithListSync())
  return () => {
    alertListeners = alertListeners.filter((l) => l !== listener)
  }
}

function notifyListeners(alert: ActiveAlertPayload | null) {
  const payload = alert ? getActiveAlertWithListSync() : null
  alertListeners.forEach((l) => l(payload))
}

/**
 * Append a push (or "clear").
 * - Type 'none' with cities: those cities are cleared when deriving (latest mention wins).
 * - null or type 'none' with empty cities: treated as "all clear" — we push type 'none' with
 *   the list of currently derived active cities so they are cleared immediately (e.g. OREF polling).
 */
export function pushAlert(alert: ActiveAlertPayload | null): void {
  const now = Date.now()
  if (alert == null || (alert.type === 'none' && !(alert.cities?.length > 0))) {
    const currentAlerts = getDerivedActiveAlerts()
    const citiesToClear = new Set<string>()
    for (const a of currentAlerts) for (const c of a.cities) citiesToClear.add(c)
    alertPushLog.push({ type: 'none', cities: [...citiesToClear], receivedAt: now })
  } else {
    alertPushLog.push({
      type: alert.type,
      cities: alert.cities ?? [],
      instructions: alert.instructions,
      receivedAt: now,
    })
  }
  pruneOldPushes()
  notifyListeners(getActiveAlertSync())
}

/**
 * Poll OREF live alerts. Call once to start; runs every POLL_INTERVAL_MS.
 */
export function startLiveAlertPolling(options?: { proxy?: string }) {
  async function poll() {
    try {
      const pikudHaoref = await getPikudHaoref()
      pikudHaoref.getActiveAlert(
        (err: Error | null, alert: ActiveAlertPayload) => {
          if (err) {
            console.warn('OREF poll error:', err.message)
            return
          }
          const hasAlert = alert && alert.type !== 'none' && (alert.cities?.length ?? 0) > 0
          pushAlert(hasAlert ? alert : null)
        },
        options ? { proxy: options.proxy } : {}
      )
    } catch (e) {
      console.warn('OREF poll exception:', e)
    }
    setTimeout(poll, POLL_INTERVAL_MS)
  }
  poll()
}

// In-memory history cache (populated when frontend calls GET /api/alerts/history?lang=...)
let historyCache: AlertHistoryEntryPayload[] = []
let historyCacheTime = 0
let historySummaryCache: { countByLocation: Map<string, number>; maxAlerts: number } | null = null
/** Half-hour slot aggregates: slot 0 = 00:00, 1 = 00:30, ... 47 = 23:30. */
let historyBySlotCache: {
  countByLocationBySlot: Map<string, Map<number, number>>
  maxAlertsBySlot: Map<number, number>
} | null = null

/** Parse time to half-hour slot (0-47). 0 = 00:00, 1 = 00:30, ..., 47 = 23:30. Returns null if unknown. */
function getSlotFromEntry(entry: AlertHistoryEntryPayload): number | null {
  const e = entry as AlertHistoryEntryPayload & { date?: string }
  let hour = 0
  let minute = 0
  const t = (e.time ?? '').trim()
  if (t) {
    const match = t.match(/^(\d{1,2}):(\d{1,2})/)
    if (match) {
      hour = Math.min(23, Math.max(0, parseInt(match[1], 10)))
      minute = Math.min(59, Math.max(0, parseInt(match[2], 10)))
      const slot = hour * 2 + (minute >= 30 ? 1 : 0)
      return Math.min(47, slot)
    }
  }
  for (const field of [e.datetime, e.date]) {
    const dt = (field ?? '').trim()
    if (!dt) continue
    const d = new Date(dt)
    if (!Number.isNaN(d.getTime())) {
      hour = d.getHours()
      minute = d.getMinutes()
      const slot = hour * 2 + (minute >= 30 ? 1 : 0)
      return Math.min(47, slot)
    }
    // DD.MM.YYYY HH:mm or DD.MM.YYYY
    const parts = dt.split(/\s+/)
    if (parts.length >= 2 && /^\d{1,2}:\d{1,2}/.test(parts[1])) {
      const timeMatch = parts[1].match(/^(\d{1,2}):(\d{1,2})/)
      if (timeMatch) {
        hour = Math.min(23, Math.max(0, parseInt(timeMatch[1], 10)))
        minute = Math.min(59, Math.max(0, parseInt(timeMatch[2], 10)))
        return Math.min(47, hour * 2 + (minute >= 30 ? 1 : 0))
      }
    }
  }
  return null
}

/** Build all caches from a list of history entries (shared by OREF and CSV loader). */
function buildCachesFromList(list: AlertHistoryEntryPayload[]): void {
  const countByLocation = new Map<string, number>()
  const countByLocationBySlot = new Map<string, Map<number, number>>()
  for (const h of list) {
    const entry = h as AlertHistoryEntryPayload & { location?: string; city?: string; name?: string }
    const loc = (entry.data ?? entry.location ?? entry.city ?? entry.name ?? '').toString().trim()
    if (!loc) continue
    countByLocation.set(loc, (countByLocation.get(loc) || 0) + 1)
    const slot = getSlotFromEntry(entry)
    if (slot != null) {
      if (!countByLocationBySlot.has(loc)) countByLocationBySlot.set(loc, new Map())
      const bySlot = countByLocationBySlot.get(loc)!
      bySlot.set(slot, (bySlot.get(slot) || 0) + 1)
    }
  }
  const maxAlerts = countByLocation.size ? Math.max(...countByLocation.values()) : 0
  const maxAlertsBySlot = new Map<number, number>()
  for (const bySlot of countByLocationBySlot.values()) {
    for (const [slot, count] of bySlot) {
      maxAlertsBySlot.set(slot, Math.max(maxAlertsBySlot.get(slot) ?? 0, count))
    }
  }
  historyCache = list
  historyCacheTime = Date.now()
  historySummaryCache = { countByLocation, maxAlerts }
  historyBySlotCache = { countByLocationBySlot, maxAlertsBySlot }
}

/** Parse israel-alerts-data CSV line; returns { data, date, time, datetime, category_desc } or null. */
function parseHistoryCsvLine(line: string): { data: string; date: string; time: string; datetime: string; category_desc: string } | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let data: string
  let rest: string
  if (trimmed.startsWith('"')) {
    const endQuote = trimmed.indexOf('"', 1)
    if (endQuote === -1) return null
    data = trimmed.slice(1, endQuote).trim()
    rest = trimmed.slice(endQuote + 2)
  } else {
    const idx = trimmed.indexOf(',')
    if (idx === -1) return null
    data = trimmed.slice(0, idx).trim()
    rest = trimmed.slice(idx + 1)
  }
  const parts = rest.split(',')
  if (parts.length < 5) return null
  const date = parts[0]?.trim() ?? ''
  const time = parts[1]?.trim() ?? ''
  const datetime = parts[2]?.trim() ?? ''
  const category_desc = (parts[4] ?? '').trim()
  return { data, date, time, datetime, category_desc }
}

/** Load history from israel-alerts-data CSV (missile-only). Uses only the last 7 days of data in the CSV. */
function loadHistoryFromCsvText(csvText: string): AlertHistoryEntryPayload[] {
  const lines = csvText.split(/\r?\n/)
  const entries: AlertHistoryEntryPayload[] = []
  const missileKeywords = ['טילים', 'רקטות', 'missile', 'rocket']
  const isMissile = (desc: string) => missileKeywords.some((k) => desc.includes(k))
  for (let i = 1; i < lines.length; i++) {
    const row = parseHistoryCsvLine(lines[i])
    if (!row || !isMissile(row.category_desc)) continue
    const locations = row.data.split(',').map((s) => s.trim()).filter(Boolean)
    for (const loc of locations) {
      entries.push({
        data: loc,
        date: row.date,
        time: row.time,
        datetime: row.datetime,
      })
    }
  }
  if (entries.length === 0) return []
  const lastWeekMs = 7 * 24 * 60 * 60 * 1000
  let maxDate = 0
  for (const e of entries) {
    const t = new Date(e.datetime ?? 0).getTime()
    if (!Number.isNaN(t)) maxDate = Math.max(maxDate, t)
  }
  const cutoff = maxDate - lastWeekMs
  return entries.filter((e) => {
    const t = new Date(e.datetime ?? 0).getTime()
    return !Number.isNaN(t) && t >= cutoff
  })
}

/** Fetch and cache history from CSV URL (e.g. dleshem/israel-alerts-data). Returns true if used. */
async function tryLoadHistoryFromCsvUrl(url: string): Promise<boolean> {
  try {
    const { data } = await axios.get<string>(url, {
      timeout: 60000,
      responseType: 'text',
      maxContentLength: 50 * 1024 * 1024,
    })
    if (!data || typeof data !== 'string') return false
    const list = loadHistoryFromCsvText(data)
    if (list.length === 0) return false
    buildCachesFromList(list)
    console.log('Alert history: loaded from CSV, entries:', list.length)
    return true
  } catch (e) {
    console.warn('Alert history CSV fetch failed:', e)
    return false
  }
}

/** Extract array from OREF response (shape may vary). */
function extractHistoryArray(data: unknown): AlertHistoryEntryPayload[] {
  if (!data || typeof data !== 'object') return []
  const d = data as Record<string, unknown>
  if (Array.isArray(d)) return d as AlertHistoryEntryPayload[]
  if (Array.isArray(d.history)) return d.history as AlertHistoryEntryPayload[]
  if (Array.isArray(d.data)) return d.data as AlertHistoryEntryPayload[]
  if (Array.isArray(d.Alarms)) return d.Alarms as AlertHistoryEntryPayload[]
  if (Array.isArray(d.alarms)) return d.alarms as AlertHistoryEntryPayload[]
  return []
}

/** Fetch from OREF with given lang; filter to missile alerts; summarize by location. If ALERT_HISTORY_CSV_URL is set, use that for long history instead (OREF returns a short window). Uses in-memory cache for HISTORY_CACHE_TTL_MS to avoid re-fetching on every request. */
export async function fetchAndCacheHistory(lang: HistoryLang): Promise<{
  history: AlertHistoryEntryPayload[]
  countByLocation: Record<string, number>
  maxAlerts: number
}> {
  const now = Date.now()
  if (historySummaryCache && now - historyCacheTime < HISTORY_CACHE_TTL_MS) {
    return {
      history: historyCache,
      countByLocation: Object.fromEntries(historySummaryCache.countByLocation),
      maxAlerts: historySummaryCache.maxAlerts,
    }
  }

  const csvUrl = process.env.ALERT_HISTORY_CSV_URL
  if (csvUrl && csvUrl.trim()) {
    const used = await tryLoadHistoryFromCsvUrl(csvUrl.trim())
    if (used && historySummaryCache) {
      return {
        history: historyCache,
        countByLocation: Object.fromEntries(historySummaryCache.countByLocation),
        maxAlerts: historySummaryCache.maxAlerts,
      }
    }
  }

  try {
    const { data } = await axios.get<unknown>(
      `${OREF_HISTORY_URL}?lang=${lang}&mode=${HISTORY_MODE}`,
      { timeout: 10000 }
    )
    const raw = extractHistoryArray(data)
    const list = raw.filter((h) => isMissileAlert(h))
    if (raw.length > 0 && list.length === 0) {
      console.warn('Alert history: all entries filtered out (missile filter). Raw count:', raw.length)
    }
    if (raw.length === 0 && data != null) {
      const keys = typeof data === 'object' && data !== null ? Object.keys(data) : []
      console.warn('Alert history: no array in response. Type:', typeof data, 'Keys:', keys)
    }
    buildCachesFromList(list)
    return {
      history: historyCache,
      countByLocation: Object.fromEntries(historySummaryCache!.countByLocation),
      maxAlerts: historySummaryCache!.maxAlerts,
    }
  } catch (e) {
    const msg = axios.isAxiosError(e) ? `${e.message}${e.response?.status ? ` (${e.response.status})` : ''}` : String(e)
    console.warn('Alert history fetch failed:', msg, e)
    const countByLocation = historySummaryCache?.countByLocation ?? new Map()
    return {
      history: historyCache,
      countByLocation: Object.fromEntries(countByLocation),
      maxAlerts: historySummaryCache?.maxAlerts ?? 0,
    }
  }
}

/** Force the next fetchAndCacheHistory to refetch (e.g. for daily refresh). */
export function invalidateHistoryCache(): void {
  historyCacheTime = 0
}

/** Returns cached history (missile-only). Empty until fetchAndCacheHistory(lang) is called (e.g. on site load). */
export async function getAlertHistory(): Promise<AlertHistoryEntryPayload[]> {
  return historyCache
}

/** Returns cached summary (count by location, maxAlerts) for zone scoring. */
export function getAlertHistorySummary(): { countByLocation: Map<string, number>; maxAlerts: number } | null {
  return historySummaryCache
}

/** Returns per half-hour summary for zone scoring. Slot 0 = 00:00, 1 = 00:30, ... 47 = 23:30. */
export function getAlertHistorySummaryBySlot(slot: number): { countByLocation: Map<string, number>; maxAlerts: number } | null {
  const s = Math.min(47, Math.max(0, Math.floor(slot)))
  const cache = historyBySlotCache
  if (!cache) return null
  const countByLocation = new Map<string, number>()
  for (const [loc, bySlot] of cache.countByLocationBySlot) {
    const count = bySlot.get(s) ?? 0
    if (count > 0) countByLocation.set(loc, count)
  }
  const maxAlerts = cache.maxAlertsBySlot.get(s) ?? 1
  return { countByLocation, maxAlerts }
}

export interface HeatmapPoint {
  lat: number
  lng: number
  weight: number
}

let heatmapCache: HeatmapPoint[] = []
let heatmapCacheTime = 0

export async function getHeatmapData(): Promise<HeatmapPoint[]> {
  const now = Date.now()
  if (heatmapCache.length > 0 && now - heatmapCacheTime < HISTORY_CACHE_TTL_MS) {
    return heatmapCache
  }
  try {
    const { createRequire } = await import('module')
    const { fileURLToPath } = await import('url')
    const { dirname, join } = await import('path')
    const __dirname = dirname(fileURLToPath(import.meta.url))
    const require = createRequire(import.meta.url)
    const cities = require(join(__dirname, '..', 'node_modules', 'pikud-haoref-api', 'cities.json')) as Array<{ value: string; name: string; name_en?: string; lat: number; lng: number }>
    const nameToCoord = new Map<string, { lat: number; lng: number }>()
    for (const c of cities || []) {
      if (c.lat == null || c.lng == null) continue
      const coord = { lat: c.lat, lng: c.lng }
      if (c.value) nameToCoord.set(c.value, coord)
      if (c.name) nameToCoord.set(c.name, coord)
      if (c.name_en) nameToCoord.set(c.name_en, coord)
    }
    const history = await getAlertHistory()
    const countByKey = new Map<string, number>()
    for (const h of history) {
      const name = (h.data || '').trim()
      if (!name) continue
      countByKey.set(name, (countByKey.get(name) || 0) + 1)
    }
    const points: HeatmapPoint[] = []
    for (const [name, weight] of countByKey) {
      let coord = nameToCoord.get(name)
      if (!coord && name) {
        const nameLower = name.trim().toLowerCase()
        for (const c of cities || []) {
          if (c.lat == null || c.lng == null) continue
          if ((c.name && nameLower.includes(c.name.toLowerCase())) ||
              (c.value && nameLower.includes(c.value.toLowerCase())) ||
              (c.name_en && nameLower.includes((c.name_en || '').toLowerCase()))) {
            coord = { lat: c.lat, lng: c.lng }
            break
          }
        }
      }
      if (coord) points.push({ lat: coord.lat, lng: coord.lng, weight })
    }
    heatmapCache = points
    heatmapCacheTime = now
    return points
  } catch (e) {
    console.warn('Heatmap data failed:', e)
    return heatmapCache
  }
}
