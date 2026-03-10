import { describe, it, expect } from 'vitest'
import { haversineMeters } from '../geo'

describe('haversineMeters', () => {
  it('returns 0 for the same point', () => {
    expect(haversineMeters(32.0, 34.0, 32.0, 34.0)).toBe(0)
  })

  it('Tel Aviv to Jerusalem is approximately 54 km', () => {
    const d = haversineMeters(32.0853, 34.7818, 31.7683, 35.2137)
    expect(d).toBeGreaterThan(50_000)
    expect(d).toBeLessThan(60_000)
  })

  it('short distance: 1 degree latitude is ~111 km', () => {
    const d = haversineMeters(32.0, 34.0, 33.0, 34.0)
    expect(d).toBeGreaterThan(110_000)
    expect(d).toBeLessThan(112_000)
  })

  it('is symmetric', () => {
    const d1 = haversineMeters(32.0, 34.0, 33.0, 35.0)
    const d2 = haversineMeters(33.0, 35.0, 32.0, 34.0)
    expect(d1).toBeCloseTo(d2, 5)
  })
})
