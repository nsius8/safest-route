# Alert 10-Minute Window – Design

**Date:** 2025-03-04  
**Goal:** Keep client in sync with alert polygons by having the server keep a 10-minute window of pushes and derive a single “active” view; client refetches on visibility/focus.

---

## Problem

- Server keeps only the **last** push; a missed or delayed push (e.g. cold Render) loses state or overwrites with stale data.
- Client can show stale polygons (no refetch when tab regains focus / app resumes).
- Polygons are fetched once when alert becomes active and are not refreshed when the server’s list of areas changes.

---

## Approach (Option A + Option 1)

1. **Server:** Store every push with a timestamp. “Active” = union of all cities from pushes in the last 10 minutes. Every request returns this derived state.
2. **Client:** Refetch alerts (and polygons) when the document becomes visible again so any request gets the latest.

---

## Server

### Data model

- **Stored push:** `{ type: string, cities: string[], instructions?: string, receivedAt: number }`  
  `receivedAt` = `Date.now()` when the server receives the push.
- **In-memory store:** Array of stored pushes. New pushes are appended; old ones are pruned (see below).
- **Window:** `ALERT_WINDOW_MS = 10 * 60 * 1000` (10 minutes).

### Pruning

- On **every push** and on **every read** of active state: remove entries where `receivedAt < now - ALERT_WINDOW_MS`.
- No background timer required; pruning is done lazily when we push or when we compute active.

### Derived “active” payload

- After pruning, take all remaining pushes.
- **Cities:** Union of all `cities` arrays (unique set of city names).
- **Type:** Use `type` from the **most recent** push (by `receivedAt`); if no pushes, `'none'`.
- **Instructions:** Use `instructions` from the most recent push.
- If the union of cities is empty, treat as “no active alert” (return `null` or `{ type: 'none', cities: [] }` for REST).

This derived value is what `getActiveAlertSync()` returns and what REST/SSE expose. Downstream (routeService, GET /alerts/active, GET /alerts/active-zones, in-zone checks) keep using the same `ActiveAlertPayload` shape; only the source of that payload changes from “last push” to “derived from window”.

### Push handler (POST /api/alerts/push)

- Validate secret and body as today.
- If body is “clear” (`type === 'none'` or empty cities): still **append** a push with `type: 'none', cities: [], receivedAt: now`. That way “all clear” has a timestamp and the window can expire it.
- Else append `{ type, cities, instructions, receivedAt: now }`.
- Prune old entries.
- Notify SSE listeners with the **derived** active payload (so SSE still sends one snapshot per update).

### SSE

- When we notify listeners after a push, send the **derived** active payload (union of cities in window), not the raw push. So clients see the same view as GET /alerts/active.

### Backward compatibility

- GET /alerts/active: returns derived `{ type, cities, instructions? }` or `{ type: 'none', cities: [] }`. Same shape as today.
- GET /alerts/active-zones: uses derived active (via `getActiveAlertSync()`). No API change.
- GET /alerts/in-zone: uses derived active. No API change.
- Route safety and zone logic already use `getActiveAlertSync()`; they automatically use the new derived value.

---

## Client

### Refetch on visibility/focus

- In `useAlerts`, when `document.visibilityState` becomes `'visible'`, call `fetchAlert()` (and ensure polygons can refresh when alert state changes).
- Optional: on Page Visibility API `visibilitychange`, also trigger a refetch of active-zones if the layer is shown (e.g. by having the alert layer depend on a “last fetched” timestamp or by refetching when `alert` changes and we’re active).

### Polygon layer

- When `active` is true, fetch `/alerts/active-zones`. Today the effect runs when `active` or `lang` (or routeCoordinates) change. To avoid stale polygons after a visibility refetch, either:
  - Refetch polygons whenever we refetch alerts and the alert is active (e.g. pass a refetch trigger from useAlerts into the layer), or
  - Have the alert layer refetch when it becomes visible (e.g. when `active` turns true or when a visibility refetch has just run and alert is still active). Simplest: when `useAlerts` refetches on visibility and the alert state changes (or remains active), the parent can pass `alert` and the layer can refetch when `alert` reference/contents change (e.g. when cities list changes).

Recommendation: add a “refetch key” or “lastSyncAt” from useAlerts that the map/layer can use to refetch active-zones when the user comes back to the tab, so polygons stay in sync without changing the existing effect deps too much.

---

## Configuration

- `ALERT_WINDOW_MS`: default 10 minutes; can be env (e.g. `ALERT_WINDOW_MINUTES`) for tuning.

---

## Testing (manual / later)

- Pusher sends several pushes over 10 minutes; GET /alerts/active and /alerts/active-zones show union of cities; after 10 minutes without new pushes, old entries prune and list shrinks or goes empty.
- Client: tab in background, server gets new push; bring tab to foreground and confirm polygons/alert state update after refetch.

---

## Implementation plan

| Step | Task | Notes |
|------|------|--------|
| 1 | **alertService.ts** – Add `ALERT_WINDOW_MS`, array of `{ type, cities, instructions?, receivedAt }`; `pruneOldPushes()`; `getDerivedActive()` (union cities, latest type/instructions); replace `currentAlert` usage with derived value; `pushAlert()` appends push, prunes, then notifies with derived payload. | Keep `getActiveAlertSync()` returning same shape; implement by calling `getDerivedActive()`. |
| 2 | **server/index.ts** – Push handler: for "clear" payloads still call `pushAlert({ type: 'none', cities: [], receivedAt: now })` so window can expire. | Minimal change: ensure we pass an object the service can store with timestamp. |
| 3 | **useAlerts.ts** – On `visibilitychange`, if `document.visibilityState === 'visible'`, call `refetch()`. Expose a simple `alertUpdatedAt` (number) or refetch counter so the map can refetch zones. | Use a ref/counter that increments on each successful fetch. |
| 4 | **ActiveAlertLayer** – Accept optional `alertUpdatedAt` (or similar) in props; when alert is active, include it in effect deps so polygons refetch when user returns to tab. | App passes `alertUpdatedAt` from useAlerts into Map → ActiveAlertLayer. |
| 5 | **App.tsx** – Pass `alertUpdatedAt` from useAlerts to Map so ActiveAlertLayer can depend on it. | One prop thread. |
