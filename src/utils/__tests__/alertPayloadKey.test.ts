import { describe, it, expect } from 'vitest'
import { alertPayloadKey } from '../alertPayloadKey'

describe('alertPayloadKey', () => {
  it('returns "none" for null', () => {
    expect(alertPayloadKey(null)).toBe('none')
  })

  it('returns "none" for type: none', () => {
    expect(alertPayloadKey({ type: 'none', cities: [] })).toBe('none')
  })

  it('returns "none" for empty cities', () => {
    expect(alertPayloadKey({ type: 'missiles', cities: [] })).toBe('none')
  })

  it('returns stable key for single alert', () => {
    const key = alertPayloadKey({ type: 'missiles', cities: ['Tel Aviv', 'Haifa'] })
    expect(key).toBe('missiles:Haifa,Tel Aviv')
  })

  it('city order does not matter (sorted)', () => {
    const k1 = alertPayloadKey({ type: 'missiles', cities: ['Haifa', 'Tel Aviv'] })
    const k2 = alertPayloadKey({ type: 'missiles', cities: ['Tel Aviv', 'Haifa'] })
    expect(k1).toBe(k2)
  })

  it('different type produces different key', () => {
    const k1 = alertPayloadKey({ type: 'missiles', cities: ['Tel Aviv'] })
    const k2 = alertPayloadKey({ type: 'hostileAircraftIntrusion', cities: ['Tel Aviv'] })
    expect(k1).not.toBe(k2)
  })

  it('different cities produce different key', () => {
    const k1 = alertPayloadKey({ type: 'missiles', cities: ['Tel Aviv'] })
    const k2 = alertPayloadKey({ type: 'missiles', cities: ['Haifa'] })
    expect(k1).not.toBe(k2)
  })

  it('handles response with alerts[] (multiple types)', () => {
    const key = alertPayloadKey({
      type: 'multiple',
      cities: ['Tel Aviv', 'Haifa'],
      alerts: [
        { type: 'missiles', cities: ['Tel Aviv'] },
        { type: 'hostileAircraftIntrusion', cities: ['Haifa'] },
      ],
    })
    expect(key).toBe('hostileAircraftIntrusion:Haifa|missiles:Tel Aviv')
  })

  it('alerts[] order does not matter (sorted)', () => {
    const k1 = alertPayloadKey({
      type: 'multiple',
      cities: ['Tel Aviv', 'Haifa'],
      alerts: [
        { type: 'missiles', cities: ['Tel Aviv'] },
        { type: 'hostileAircraftIntrusion', cities: ['Haifa'] },
      ],
    })
    const k2 = alertPayloadKey({
      type: 'multiple',
      cities: ['Haifa', 'Tel Aviv'],
      alerts: [
        { type: 'hostileAircraftIntrusion', cities: ['Haifa'] },
        { type: 'missiles', cities: ['Tel Aviv'] },
      ],
    })
    expect(k1).toBe(k2)
  })

  it('same payload returns same key (stability)', () => {
    const data = { type: 'missiles', cities: ['Tel Aviv', 'Haifa'] }
    expect(alertPayloadKey(data)).toBe(alertPayloadKey(data))
  })
})
