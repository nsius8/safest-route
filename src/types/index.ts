// Alert types (Pikud HaOref)
export interface ActiveAlert {
  type: string
  cities: string[]
  instructions?: string
}

/** Response from GET /alerts/active when there is an active alert: merged view + list by type */
export interface ActiveAlertResponse extends ActiveAlert {
  /** Present when active; one item per alert type (e.g. missiles, hostileAircraftIntrusion) */
  alerts?: ActiveAlert[]
}

// Geographic
export interface LatLng {
  lat: number
  lng: number
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
