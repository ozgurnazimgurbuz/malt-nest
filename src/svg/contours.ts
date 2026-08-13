import { FillRule, unionD } from 'clipper2-ts'
import type { Point } from '../geometry'
import { cleanClosedRing } from '../geometry'
import {
  pathsDToMultiPolygons,
  ringToPathD,
} from '../geometry/backend/clipperAdapter'
import { clipperPrecision } from '../geometry/tolerance'
import type { Subpath } from './pathData'

export type SvgFillRule = 'nonzero' | 'evenodd'

export type ContourGroup = {
  outer: Point[]
  holes: Point[][]
}

/** Resolve SVG fill semantics into simple outer/hole rings for nesting. */
export function classifySubpaths(
  subpaths: Subpath[],
  fillRule: SvgFillRule = 'nonzero',
): ContourGroup[] {
  const paths = []

  for (const sp of subpaths) {
    // SVG fill implicitly closes open subpaths. Two-point lines remain empty.
    const ring = cleanClosedRing(sp.points)
    if (ring.length < 3) continue
    paths.push(ringToPathD(ring))
  }

  const filled = unionD(
    paths,
    [],
    fillRule === 'evenodd' ? FillRule.EvenOdd : FillRule.NonZero,
    clipperPrecision(),
  )
  return pathsDToMultiPolygons(filled).map(({ outer, holes }) => ({
    outer: outer.points,
    holes: holes.map((hole) => hole.points),
  }))
}
