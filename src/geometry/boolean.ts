import type { MultiPolygon, Polygon } from './types'
import type { Solid } from './collide'
import { solidFromRings } from './collide'
import {
  clipperDifference,
  clipperIntersect,
  clipperUnion,
  clipperXor,
  pathsDToMultiPolygons,
  solidToPathsD,
  type PathsD,
} from './backend/clipperAdapter'
import type { GeometryIssue } from './tolerance'
import { polygonArea } from './ops'
import { geomEps } from './tolerance'

export type BooleanResult = {
  polygons: MultiPolygon[]
  issues: GeometryIssue[]
  ok: boolean
}

function solidOrPolyToPaths(input: Solid | MultiPolygon | Polygon): PathsD {
  if ('bounds' in input && 'outer' in input) {
    return solidToPathsD(input as Solid)
  }
  if ('outer' in input) {
    const mp = input as MultiPolygon
    return solidToPathsD(
      solidFromRings(
        mp.outer.points,
        mp.holes.map((h) => h.points),
      ),
    )
  }
  const poly = input as Polygon
  return solidToPathsD(solidFromRings(poly.points, []))
}

function runBoolean(
  op: (a: PathsD, b: PathsD) => PathsD,
  a: Solid | MultiPolygon | Polygon,
  b: Solid | MultiPolygon | Polygon,
): BooleanResult {
  const issues: GeometryIssue[] = []
  try {
    const paths = op(solidOrPolyToPaths(a), solidOrPolyToPaths(b))
    const polygons = pathsDToMultiPolygons(paths)
    return { polygons, issues, ok: true }
  } catch (err) {
    issues.push({
      code: 'degenerate',
      message: err instanceof Error ? err.message : 'boolean op failed',
    })
    return { polygons: [], issues, ok: false }
  }
}

export function union(
  a: Solid | MultiPolygon | Polygon,
  b: Solid | MultiPolygon | Polygon,
): BooleanResult {
  return runBoolean(clipperUnion, a, b)
}

export function difference(
  a: Solid | MultiPolygon | Polygon,
  b: Solid | MultiPolygon | Polygon,
): BooleanResult {
  return runBoolean(clipperDifference, a, b)
}

export function intersection(
  a: Solid | MultiPolygon | Polygon,
  b: Solid | MultiPolygon | Polygon,
): BooleanResult {
  return runBoolean(clipperIntersect, a, b)
}

export function xor(
  a: Solid | MultiPolygon | Polygon,
  b: Solid | MultiPolygon | Polygon,
): BooleanResult {
  return runBoolean(clipperXor, a, b)
}

export function booleanHasArea(result: BooleanResult): boolean {
  let a = 0
  for (const mp of result.polygons) {
    a += polygonArea(mp.outer.points)
    for (const h of mp.holes) a -= polygonArea(h.points)
  }
  return a > geomEps() * geomEps()
}
