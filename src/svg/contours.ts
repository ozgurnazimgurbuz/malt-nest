import type { Point } from '../geometry'
import {
  centroid,
  cleanClosedRing,
  normalizeWinding,
  pointInPolygon,
  polygonArea,
} from '../geometry'
import type { Subpath } from './pathData'

export type ContourGroup = {
  outer: Point[]
  holes: Point[][]
}

/**
 * Classify closed subpaths into outer/hole groups via containment depth.
 * Depth 0,2,4… → solid outer; depth 1,3… → hole of parent.
 *
 * Open polylines (≥2 points, endpoints not coincident) become hole-less parts.
 */
export function classifySubpaths(subpaths: Subpath[]): ContourGroup[] {
  type Node = {
    points: Point[]
    area: number
    parent: number
    children: number[]
  }

  const closed: Node[] = []
  const groups: ContourGroup[] = []

  for (const sp of subpaths) {
    const first = sp.points[0]
    const last = sp.points[sp.points.length - 1]
    if (!first || !last) continue
    const endpointsMatch = Math.hypot(first.x - last.x, first.y - last.y) <= 1e-6
    const treatClosed = sp.closed || endpointsMatch

    if (!treatClosed) {
      if (sp.points.length >= 2) groups.push({ outer: sp.points.slice(), holes: [] })
      continue
    }

    const ring = cleanClosedRing(sp.points)
    if (ring.length < 3) continue
    closed.push({
      points: ring,
      area: polygonArea(ring),
      parent: -1,
      children: [],
    })
  }

  for (let i = 0; i < closed.length; i++) {
    const ci = closed[i]!
    const probe = centroid(ci.points)
    let best = -1
    let bestArea = Infinity
    for (let j = 0; j < closed.length; j++) {
      if (i === j) continue
      const cj = closed[j]!
      if (cj.area <= ci.area + 1e-9) continue
      if (pointInPolygon(probe, cj.points) && cj.area < bestArea) {
        bestArea = cj.area
        best = j
      }
    }
    ci.parent = best
    if (best >= 0) closed[best]!.children.push(i)
  }

  function depthOf(idx: number): number {
    let d = 0
    let p = closed[idx]!.parent
    const guard = closed.length + 1
    let n = 0
    while (p >= 0 && n++ < guard) {
      d++
      p = closed[p]!.parent
    }
    return d
  }

  function emitSolid(idx: number): void {
    const outer = normalizeWinding(closed[idx]!.points, true)
    const holes: Point[][] = []
    for (const child of closed[idx]!.children) {
      if (depthOf(child) === depthOf(idx) + 1) {
        holes.push(normalizeWinding(closed[child]!.points, false))
        for (const grand of closed[child]!.children) {
          if (depthOf(grand) === depthOf(idx) + 2) emitSolid(grand)
        }
      }
    }
    groups.push({ outer, holes })
  }

  for (let i = 0; i < closed.length; i++) {
    if (depthOf(i) === 0) emitSolid(i)
  }

  return groups
}
