import { type Solid } from './collide'
import { solidsCollide } from './spacingCollide'
import { solidInsideHole, holeAsContainer } from './containment'
import { offsetPolygon } from './offset'
import { boundingBox } from './ops'
import { geomEps } from './tolerance'
import type { Point, Polygon } from './types'

export type HoleFitResult = {
  fits: boolean
  holeIndex: number
  reason?:
    | 'disabled'
    | 'no_hole'
    | 'too_large'
    | 'spacing'
    | 'not_contained'
    | 'ok'
  /** Suggested translation of guest local → world (when fits). */
  translation?: Point
}

/**
 * Geometry foundation for part-in-part.
 * Does not force optimizer usage — callers check allowPartInPart.
 */
export function canFitInHole(
  host: Solid,
  guest: Solid,
  holeIndex: number,
  spacingMm: number,
): HoleFitResult {
  const hole = host.holes[holeIndex]
  if (!hole) {
    return { fits: false, holeIndex, reason: 'no_hole' }
  }

  const spacing = Math.max(0, spacingMm)
  const container = holeAsContainer(hole)

  // Shrink hole by spacing for geometrically meaningful clearance from hole wall
  let effective: Polygon = container
  if (spacing > geomEps()) {
    const off = offsetPolygon(container, -spacing)
    if (off.polygon.points.length < 3) {
      return { fits: false, holeIndex, reason: 'spacing' }
    }
    effective = off.polygon
  }

  const hb = boundingBox(effective.points)
  const gb = guest.bounds
  if (gb.width > hb.width + geomEps() || gb.height > hb.height + geomEps()) {
    return { fits: false, holeIndex, reason: 'too_large' }
  }

  // Candidate: place guest AABB bottom-left into effective hole AABB
  const tx = hb.minX - gb.minX
  const ty = hb.minY - gb.minY
  const placed = translateLocal(guest, tx, ty)

  if (!solidInsideHole(placed, { points: effective.points })) {
    // try centered
    const cx =
      (hb.minX + hb.maxX) / 2 - (gb.minX + gb.maxX) / 2
    const cy =
      (hb.minY + hb.maxY) / 2 - (gb.minY + gb.maxY) / 2
    const placed2 = translateLocal(guest, cx, cy)
    if (!solidInsideHole(placed2, { points: effective.points })) {
      return { fits: false, holeIndex, reason: 'not_contained' }
    }
    // still must not collide with host solid (hole empty ⇒ should be fine)
    if (solidsCollide(host, placed2, 0)) {
      return { fits: false, holeIndex, reason: 'not_contained' }
    }
    return {
      fits: true,
      holeIndex,
      reason: 'ok',
      translation: { x: cx, y: cy },
    }
  }

  if (solidsCollide(host, placed, 0)) {
    return { fits: false, holeIndex, reason: 'not_contained' }
  }

  return {
    fits: true,
    holeIndex,
    reason: 'ok',
    translation: { x: tx, y: ty },
  }
}

function translateLocal(solid: Solid, dx: number, dy: number): Solid {
  return {
    outer: {
      points: solid.outer.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    },
    holes: solid.holes.map((h) => ({
      points: h.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    })),
    bounds: {
      minX: solid.bounds.minX + dx,
      minY: solid.bounds.minY + dy,
      maxX: solid.bounds.maxX + dx,
      maxY: solid.bounds.maxY + dy,
      width: solid.bounds.width,
      height: solid.bounds.height,
    },
  }
}

/** Enumerate host holes that could admit guest (bbox filter). */
export function candidateHolesForPart(
  host: Solid,
  guest: Solid,
  spacingMm: number,
): number[] {
  const out: number[] = []
  const gw = guest.bounds.width + spacingMm * 2
  const gh = guest.bounds.height + spacingMm * 2
  for (let i = 0; i < host.holes.length; i++) {
    const hb = boundingBox(host.holes[i]!.points)
    if (hb.width + geomEps() >= gw && hb.height + geomEps() >= gh) {
      out.push(i)
    }
  }
  return out
}

export function findPartInPartPlacement(
  host: Solid,
  guest: Solid,
  spacingMm: number,
): HoleFitResult | null {
  const idxs = candidateHolesForPart(host, guest, spacingMm)
  for (const i of idxs) {
    const r = canFitInHole(host, guest, i, spacingMm)
    if (r.fits) return r
  }
  return null
}
