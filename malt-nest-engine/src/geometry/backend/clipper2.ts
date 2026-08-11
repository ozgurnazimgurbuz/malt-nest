import { Clipper, FillRule } from 'clipper2-ts'
import type { Point, Polygon, Ring } from '../types'
import {
  DEFAULT_TOLERANCE,
  type GeometryTolerance,
} from '../tolerance'

/**
 * Geometry backend port — Clipper2 is one implementation.
 * Optimizer/NFP must depend on this interface, not Clipper types.
 */
export type GeometryBackend = {
  readonly id: string
  /** True if closed paths A and B intersect (area overlap or edge cross). */
  pathsIntersect(a: Ring, b: Ring, tol?: GeometryTolerance): boolean
  /** Boolean intersection area (mm²) of two polygons (outers only for ETAP 1). */
  intersectionArea(a: Polygon, b: Polygon, tol?: GeometryTolerance): number
}

function toPathsD(ring: Ring) {
  return [ring.map((p) => ({ x: p.x, y: p.y }))]
}

/**
 * Clipper2 adapter (`clipper2-ts`).
 * Uses floating `*D` APIs. `clipperScale` documents intended Path64 precision
 * for future integer call sites (ETAP 3+); see `roundTripScaled`.
 */
export function createClipper2Backend(
  defaultTol: GeometryTolerance = DEFAULT_TOLERANCE,
): GeometryBackend {
  return {
    id: 'clipper2-ts',
    pathsIntersect(a, b, tol = defaultTol) {
      void tol
      try {
        const inter = Clipper.intersectD(
          toPathsD(a),
          toPathsD(b),
          FillRule.NonZero,
        )
        return inter.length > 0 && Math.abs(Clipper.areaPathsD(inter)) > 0
      } catch {
        return false
      }
    },
    intersectionArea(a, b, tol = defaultTol) {
      void tol
      try {
        const inter = Clipper.intersectD(
          toPathsD(a.outer),
          toPathsD(b.outer),
          FillRule.NonZero,
        )
        return Math.abs(Clipper.areaPathsD(inter))
      } catch {
        return 0
      }
    },
  }
}

/** Round-trip float→int→float using clipperScale; for precision tests. */
export function roundTripScaled(
  p: Point,
  scale: number = DEFAULT_TOLERANCE.clipperScale,
): Point {
  return {
    x: Math.round(p.x * scale) / scale,
    y: Math.round(p.y * scale) / scale,
  }
}
