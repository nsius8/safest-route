import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  _resetForTest,
  _pushForTest,
  getActiveAlertSync,
  getActiveAlertsSync,
  getActiveAlertWithListSync,
  pushAlert,
} from '../alertService'

beforeEach(() => {
  _resetForTest()
  vi.restoreAllMocks()
})

const now = Date.now()

describe('getDerivedActiveAlerts (via public API)', () => {
  it('returns null when no pushes', () => {
    expect(getActiveAlertSync()).toBe(null)
    expect(getActiveAlertsSync()).toEqual([])
  })

  it('returns alert for a single push', () => {
    _pushForTest('missiles', ['Tel Aviv', 'Haifa'], now)
    const result = getActiveAlertSync()
    expect(result).not.toBe(null)
    expect(result!.type).toBe('missiles')
    expect(result!.cities).toContain('Tel Aviv')
    expect(result!.cities).toContain('Haifa')
  })

  it('unions cities from multiple pushes of the same type', () => {
    _pushForTest('missiles', ['Tel Aviv'], now - 5000)
    _pushForTest('missiles', ['Haifa'], now - 3000)
    const list = getActiveAlertsSync()
    expect(list).toHaveLength(2)
    const allCities = list.flatMap((a) => a.cities)
    expect(allCities).toContain('Tel Aviv')
    expect(allCities).toContain('Haifa')
    const merged = getActiveAlertSync()!
    expect(merged.cities).toContain('Tel Aviv')
    expect(merged.cities).toContain('Haifa')
  })

  it('latest push for a city wins (overrides type)', () => {
    _pushForTest('missiles', ['Tel Aviv'], now - 5000)
    _pushForTest('hostileAircraftIntrusion', ['Tel Aviv'], now - 2000)
    const list = getActiveAlertsSync()
    const types = list.map((a) => a.type)
    expect(types).toContain('hostileAircraftIntrusion')
    expect(types).not.toContain('missiles')
    expect(list.flatMap((a) => a.cities)).toEqual(['Tel Aviv'])
  })
})

describe('clear-on-none', () => {
  it('type none with specific cities clears those cities', () => {
    _pushForTest('missiles', ['Tel Aviv', 'Haifa'], now - 5000)
    _pushForTest('none', ['Tel Aviv'], now - 2000)
    const result = getActiveAlertSync()!
    expect(result.cities).toContain('Haifa')
    expect(result.cities).not.toContain('Tel Aviv')
  })

  it('type none clears all cities if they are listed', () => {
    _pushForTest('missiles', ['Tel Aviv', 'Haifa'], now - 5000)
    _pushForTest('none', ['Tel Aviv', 'Haifa'], now - 2000)
    expect(getActiveAlertSync()).toBe(null)
  })

  it('pushAlert(null) clears all currently active cities', () => {
    _pushForTest('missiles', ['Tel Aviv', 'Haifa'], now - 5000)
    expect(getActiveAlertSync()).not.toBe(null)
    pushAlert(null)
    expect(getActiveAlertSync()).toBe(null)
  })

  it('pushAlert with type none and no cities clears all', () => {
    _pushForTest('missiles', ['Tel Aviv'], now - 5000)
    pushAlert({ type: 'none', cities: [] })
    expect(getActiveAlertSync()).toBe(null)
  })
})

describe('multiple types in parallel', () => {
  it('two different types produce two alerts', () => {
    _pushForTest('missiles', ['Tel Aviv'], now - 5000)
    _pushForTest('hostileAircraftIntrusion', ['Haifa'], now - 3000)
    const list = getActiveAlertsSync()
    expect(list).toHaveLength(2)
    const types = list.map((a) => a.type).sort()
    expect(types).toEqual(['hostileAircraftIntrusion', 'missiles'])
  })

  it('merged view has type "multiple" with union of cities', () => {
    _pushForTest('missiles', ['Tel Aviv'], now - 5000)
    _pushForTest('hostileAircraftIntrusion', ['Haifa'], now - 3000)
    const merged = getActiveAlertSync()!
    expect(merged.type).toBe('multiple')
    expect(merged.cities.sort()).toEqual(['Haifa', 'Tel Aviv'])
  })

  it('single type gives type name, not "multiple"', () => {
    _pushForTest('missiles', ['Tel Aviv'], now - 5000)
    const merged = getActiveAlertSync()!
    expect(merged.type).toBe('missiles')
  })
})

describe('same type different pushes (e.g. two newsFlash)', () => {
  it('two pushes of same type at different times stay separate', () => {
    _pushForTest('newsFlash', ['Tel Aviv'], now - 5000, 'Event A')
    _pushForTest('newsFlash', ['Haifa'], now - 3000, 'Event B')
    const list = getActiveAlertsSync()
    expect(list).toHaveLength(2)
    expect(list.every((a) => a.type === 'newsFlash')).toBe(true)
    const allCities = list.flatMap((a) => a.cities).sort()
    expect(allCities).toEqual(['Haifa', 'Tel Aviv'])
  })

  it('same city in two pushes of same type: latest wins', () => {
    _pushForTest('newsFlash', ['Tel Aviv'], now - 5000, 'Event A')
    _pushForTest('newsFlash', ['Tel Aviv'], now - 3000, 'Event B')
    const list = getActiveAlertsSync()
    expect(list).toHaveLength(1)
    expect(list[0].cities).toEqual(['Tel Aviv'])
    expect(list[0].instructions).toBe('Event B')
  })
})

describe('getActiveAlertWithListSync', () => {
  it('returns null when no alerts', () => {
    expect(getActiveAlertWithListSync()).toBe(null)
  })

  it('single type: no alerts[] property', () => {
    _pushForTest('missiles', ['Tel Aviv'], now)
    const result = getActiveAlertWithListSync()!
    expect(result.type).toBe('missiles')
    expect('alerts' in result).toBe(false)
  })

  it('multiple types: includes alerts[] property', () => {
    _pushForTest('missiles', ['Tel Aviv'], now - 5000)
    _pushForTest('hostileAircraftIntrusion', ['Haifa'], now - 3000)
    const result = getActiveAlertWithListSync()!
    expect(result.type).toBe('multiple')
    expect(result.alerts).toBeDefined()
    expect(result.alerts!).toHaveLength(2)
  })
})

describe('pruning (10-min window)', () => {
  it('pushes older than 10 minutes are excluded', () => {
    const tenMinAgo = now - 10 * 60 * 1000 - 1000
    _pushForTest('missiles', ['Tel Aviv'], tenMinAgo)
    expect(getActiveAlertSync()).toBe(null)
  })

  it('push just within window is included', () => {
    const justWithin = now - 10 * 60 * 1000 + 5000
    _pushForTest('missiles', ['Tel Aviv'], justWithin)
    expect(getActiveAlertSync()).not.toBe(null)
  })
})

describe('instructions', () => {
  it('instructions from push are carried through', () => {
    _pushForTest('missiles', ['Tel Aviv'], now, 'Go to shelter')
    const result = getActiveAlertSync()!
    expect(result.instructions).toBe('Go to shelter')
  })

  it('push without instructions has undefined instructions', () => {
    _pushForTest('missiles', ['Tel Aviv'], now)
    const result = getActiveAlertSync()!
    expect(result.instructions).toBeUndefined()
  })
})
