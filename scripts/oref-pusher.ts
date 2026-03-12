/**
 * Run this script on a machine in Israel (e.g. your home). It polls OREF and
 * pushes alert updates to your Render server so the app gets live alerts without
 * a proxy.
 *
 * Env (use .env in project root or export):
 *   PUSH_URL     - Render app URL, e.g. https://safest-route.onrender.com
 *   ALERT_PUSH_SECRET - Same secret as ALERT_PUSH_SECRET on Render (min 16 chars)
 *
 * Run: npx tsx scripts/oref-pusher.ts
 */
import 'dotenv/config'
import * as pikudHaoref from 'pikud-haoref-api'

const POLL_MS = 3000
const PUSH_MAX_RETRIES = 4
const PUSH_RETRY_DELAY_MS = 6000

const PUSH_URL = process.env.PUSH_URL || process.env.RENDER_APP_URL
const SECRET = process.env.ALERT_PUSH_SECRET

function getPayload(alert: { type: string; cities?: string[]; instructions?: string } | null): { type: string; cities: string[]; instructions?: string } | null {
  if (!alert || alert.type === 'none' || !alert.cities?.length) return null
  return {
    type: alert.type,
    cities: alert.cities,
    instructions: alert.instructions,
  }
}

function payloadKey(p: { type: string; cities: string[] } | null): string {
  if (!p) return 'none'
  return `${p.type}:${p.cities.slice().sort().join(',')}`
}

let lastPushedKey: string | null = null

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function pushToServer(payload: { type: string; cities: string[]; instructions?: string } | null): Promise<void> {
  const key = payloadKey(payload)
  if (key === lastPushedKey) return
  const url = `${PUSH_URL?.replace(/\/$/, '')}/api/alerts/push`
  const body = payload ? payload : { type: 'none', cities: [] }
  for (let attempt = 1; attempt <= PUSH_MAX_RETRIES; attempt++) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SECRET}`,
        },
        body: JSON.stringify(body),
      })
      if (r.ok) {
        lastPushedKey = key
        return
      }
      console.warn('Push failed:', r.status, r.statusText)
      // Non-retryable HTTP errors
      if (r.status === 401 || r.status === 400) {
        return
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      if (attempt === PUSH_MAX_RETRIES) {
        console.warn('Push error (after', PUSH_MAX_RETRIES, 'attempts):', err)
        return
      }
      console.warn('Push error (attempt', attempt, '/', PUSH_MAX_RETRIES, '), retrying in', PUSH_RETRY_DELAY_MS / 1000, 's:', err)
      await sleep(PUSH_RETRY_DELAY_MS)
    }
  }
}

function poll(): void {
  pikudHaoref.getActiveAlert((err: Error | null, alert: { type: string; cities?: string[]; instructions?: string }) => {
    if (err) {
      console.warn('OREF error:', err.message)
      setTimeout(poll, POLL_MS)
      return
    }
    const payload = getPayload(alert)
    pushToServer(payload)
    setTimeout(poll, POLL_MS)
  })
}

function main(): void {
  if (!PUSH_URL?.trim()) {
    console.error('Missing PUSH_URL or RENDER_APP_URL')
    process.exit(1)
  }
  if (!SECRET || SECRET.length < 16) {
    console.error('Missing or short ALERT_PUSH_SECRET (min 16 chars)')
    process.exit(1)
  }
  console.log('Pushing OREF alerts to', PUSH_URL)
  poll()
}

main()
