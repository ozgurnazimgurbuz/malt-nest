import type { BoundingBox, Ring } from '../geometry/types'
import type { GeometryTolerance } from '../geometry/tolerance'
import { DEFAULT_TOLERANCE } from '../geometry/tolerance'

/**
 * NFP result: region(s) in which the orbiting shape's **reference point**
 * (centroid) must not lie (outer) or may lie (inner free region).
 *
 * Outer NFP: forbidden region for collision (and gap).
 * Inner NFP: free region for containment inside a container/hole.
 */
export type NfpRegion = {
  readonly outer: Ring
  readonly holes: readonly Ring[]
}

export type NfpResult = {
  readonly kind: 'outer' | 'inner'
  /** Stationary / container shape id */
  readonly stationaryId: string
  /** Orbiting shape id */
  readonly orbitingId: string
  /** Reference = centroid of orbiting shape (matches Placement.position). */
  readonly reference: 'centroid'
  readonly gap: number
  /** One or more regions (usually one). */
  readonly regions: readonly NfpRegion[]
  readonly bounds: BoundingBox | null
  readonly algorithm: 'minkowski-clipper2'
}

export type NfpOptions = {
  /** Manufacturing clearance (mm). Expands outer forbidden / shrinks inner free. */
  readonly gap?: number
  readonly tolerance?: GeometryTolerance
}

export const DEFAULT_NFP_OPTIONS: Required<NfpOptions> = {
  gap: 0,
  tolerance: DEFAULT_TOLERANCE,
}

export type NfpPointClass = 'inside' | 'boundary' | 'outside'
