import type { Point, Polygon } from './types'
import { boundingBox } from './ops'

export function translatePoint(p: Point, dx: number, dy: number): Point {
  return { x: p.x + dx, y: p.y + dy }
}

export function translatePoints(points: Point[], dx: number, dy: number): Point[] {
  return points.map((p) => translatePoint(p, dx, dy))
}

export function rotatePoint(p: Point, deg: number, origin: Point = { x: 0, y: 0 }): Point {
  const rad = (deg * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const x = p.x - origin.x
  const y = p.y - origin.y
  return {
    x: origin.x + x * c - y * s,
    y: origin.y + x * s + y * c,
  }
}

export function rotatePoints(
  points: Point[],
  deg: number,
  origin: Point = { x: 0, y: 0 },
): Point[] {
  if (deg % 360 === 0) return points.map((p) => ({ ...p }))
  return points.map((p) => rotatePoint(p, deg, origin))
}

export function transformPolygon(
  poly: Polygon,
  rotationDeg: number,
  dx: number,
  dy: number,
  origin: Point = { x: 0, y: 0 },
): Polygon {
  return {
    points: translatePoints(rotatePoints(poly.points, rotationDeg, origin), dx, dy),
  }
}

/** Local origin for rotation: bounding-box center of the outer contour. */
export function partRotationOrigin(outer: Point[]): Point {
  const b = boundingBox(outer)
  return { x: b.minX + b.width / 2, y: b.minY + b.height / 2 }
}
