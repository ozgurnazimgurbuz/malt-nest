import {
  makeShape,
  normalizeShape,
  shapeCentroid,
} from '../geometry'
import type { Point, Shape } from '../geometry/types'
import { createPlacement, collidePlacements } from '../placement'
import { computeOuterNfp, nfpContainsPoint } from './compute'
import type { NfpResult } from './types'

export function rectShape(id: string, w: number, h: number): Shape {
  return makeShape(id, [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ])
}

export function triangleShape(id: string): Shape {
  return makeShape(id, [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 0, y: 4 },
  ])
}

export function LShape(id: string): Shape {
  return makeShape(id, [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 1.5 },
    { x: 1.5, y: 1.5 },
    { x: 1.5, y: 4 },
    { x: 0, y: 4 },
  ])
}

export function frameShape(id: string): Shape {
  return makeShape(
    id,
    [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ],
    [
      [
        { x: 5, y: 5 },
        { x: 15, y: 5 },
        { x: 15, y: 15 },
        { x: 5, y: 15 },
      ],
    ],
  )
}

export function stationaryPose(stationary: Shape) {
  const c = shapeCentroid(normalizeShape(stationary))!
  return createPlacement(stationary, c, 0)
}

/** True if orbiting centroid at `p` collides with stationary (gap-aware). */
export function oracleCollides(
  stationary: Shape,
  orbiting: Shape,
  p: Point,
  gap: number,
): boolean {
  const s = stationaryPose(stationary)
  const o = createPlacement(orbiting, p, 0)
  const hit = collidePlacements(s, o, gap)
  return hit.kind === 'overlap' || hit.kind === 'gap-violation'
}

/**
 * Grid cross-check: Outer NFP membership vs placement collision oracle.
 */
export function crossCheckOuterNfp(
  stationary: Shape,
  orbiting: Shape,
  gap: number,
  step: number,
): { checked: number; disagreements: number; nfp: NfpResult } {
  const nfp = computeOuterNfp(stationary, orbiting, { gap })
  const b = nfp.bounds
  if (!b) return { checked: 0, disagreements: 0, nfp }

  const pad = step * 2
  let checked = 0
  let disagreements = 0
  for (let x = b.minX - pad; x <= b.maxX + pad + 1e-9; x += step) {
    for (let y = b.minY - pad; y <= b.maxY + pad + 1e-9; y += step) {
      const p = { x, y }
      const inNfp = nfpContainsPoint(p, nfp)
      const collides = oracleCollides(stationary, orbiting, p, gap)
      checked++
      // Safety property for placement: collision ⇒ inside NFP.
      // NFP is a closed set (distance ≤ gap); oracle uses open (distance < gap),
      // so inNfp && !collides on the boundary is acceptable.
      if (!inNfp && collides) disagreements++
      else if (inNfp && !collides) {
        const q = { x: x + step * 0.35, y: y + step * 0.35 }
        if (
          nfpContainsPoint(q, nfp) &&
          !oracleCollides(stationary, orbiting, q, gap)
        ) {
          // Deep interior of NFP without collision → real bug
          disagreements++
        }
      }
    }
  }
  return { checked, disagreements, nfp }
}
