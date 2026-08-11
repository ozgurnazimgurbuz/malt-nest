import type { Point } from '../geometry'
import {
  cleanClosedRing,
  normalizeWinding,
  polygonArea,
  polygonContainsPolygon,
  signedArea,
} from '../geometry'
import type { Subpath } from './pathData'

export type SvgFillRule = 'nonzero' | 'evenodd'

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
export function classifySubpaths(
  subpaths: Subpath[],
  fillRule: SvgFillRule = 'nonzero',
): ContourGroup[] {
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
      // SVG fill implicitly closes open subpaths, but a two-point line has no
      // filled area and therefore cannot be a nesting part.
      if (sp.points.length >= 3 && polygonArea(sp.points) > 1e-12) {
        groups.push({ outer: sp.points.slice(), holes: [] })
      }
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
    let best = -1
    let bestArea = Infinity
    for (let j = 0; j < closed.length; j++) {
      if (i === j) continue
      const cj = closed[j]!
      if (cj.area <= ci.area + 1e-9) continue
      if (
        polygonContainsPolygon(
          { points: cj.points },
          { points: ci.points },
        ) && cj.area < bestArea
      ) {
        bestArea = cj.area
        best = j
      }
    }
    ci.parent = best
    if (best >= 0) closed[best]!.children.push(i)
  }

  const isFilled = (winding: number) =>
    fillRule === 'evenodd'
      ? Math.abs(winding) % 2 === 1
      : winding !== 0
  type Frame = {
    index: number
    parentWinding: number
    activeSolid: ContourGroup | null
  }
  const stack: Frame[] = []
  for (let i = closed.length - 1; i >= 0; i--) {
    if (closed[i]!.parent < 0) {
      stack.push({ index: i, parentWinding: 0, activeSolid: null })
    }
  }

  while (stack.length > 0) {
    const frame = stack.pop()!
    const node = closed[frame.index]!
    const delta =
      fillRule === 'evenodd' ? 1 : Math.sign(signedArea(node.points))
    const winding = frame.parentWinding + delta
    const parentFilled = isFilled(frame.parentWinding)
    const filled = isFilled(winding)
    let activeSolid = frame.activeSolid

    if (!parentFilled && filled) {
      activeSolid = {
        outer: normalizeWinding(node.points, true),
        holes: [],
      }
      groups.push(activeSolid)
    } else if (parentFilled && !filled) {
      activeSolid?.holes.push(normalizeWinding(node.points, false))
      activeSolid = null
    }

    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push({
        index: node.children[i]!,
        parentWinding: winding,
        activeSolid,
      })
    }
  }

  return groups
}
