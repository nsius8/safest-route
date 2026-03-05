// Alert types (Pikud HaOref)
export interface ActiveAlert {
  type: string
  cities: string[]
  instructions?: string
}

export interface AlertHistoryEntry {
  data: string
  date: string
  time: string
  datetime: string
}

// Geographic
export interface LatLng {
  lat: number
  lng: number
}

export interface AlertZonePolygon {
  id: string
  name: string
  coordinates: [number, number][][]
  alertCount?: number
}

/** Zone along a route with alert history score (from backend). */
export interface ZoneAlongRoute {
  coordinates: number[][]
  score: number
  name: string
  /** Raw alert count for this zone in the selected period/slot */
  occurrences?: number
}

// Routes
export interface RouteSegment {
  coordinates: [number, number][]
  distance: number
  duration: number
}

export interface SafeRoute {
  segments: RouteSegment[]
  summary: { distance: number; duration: number }
  safetyScore: number
  /** Alert risk % derived from zones along route (matches map polygons). */
  alertRiskInRoutePct?: number
  safetyDetails?: { historicalDensity: number; activeProximity: number }
}

// Shelters
export interface Shelter {
  id: string
  lat: number
  lon: number
  name?: string
  distance?: number
  walkingDuration?: number
}
