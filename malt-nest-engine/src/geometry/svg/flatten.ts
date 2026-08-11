import type { Point } from '../types'
import { DEFAULT_TOLERANCE, type GeometryTolerance } from '../tolerance'

/** Flatten cubic Bezier into polyline (chord error ≤ curveTolerance). */
export function flattenCubic(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): Point[] {
  const out: Point[] = []
  const recurse = (
    a: Point,
    b: Point,
    c: Point,
    d: Point,
    depth: number,
  ) => {
    const chord = Math.hypot(d.x - a.x, d.y - a.y)
    const d1 = Math.hypot(b.x - a.x, b.y - a.y)
    const d2 = Math.hypot(c.x - b.x, c.y - b.y)
    const d3 = Math.hypot(d.x - c.x, d.y - c.y)
    if (depth > 12 || d1 + d2 + d3 - chord <= tol.curveTolerance) {
      out.push(d)
      return
    }
    // de Casteljau split
    const ab = mid(a, b)
    const bc = mid(b, c)
    const cd = mid(c, d)
    const abc = mid(ab, bc)
    const bcd = mid(bc, cd)
    const abcd = mid(abc, bcd)
    recurse(a, ab, abc, abcd, depth + 1)
    recurse(abcd, bcd, cd, d, depth + 1)
  }
  out.push(p0)
  recurse(p0, p1, p2, p3, 0)
  return out
}

export function flattenQuadratic(
  p0: Point,
  p1: Point,
  p2: Point,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): Point[] {
  // Elevate to cubic
  const c1 = {
    x: p0.x + (2 / 3) * (p1.x - p0.x),
    y: p0.y + (2 / 3) * (p1.y - p0.y),
  }
  const c2 = {
    x: p2.x + (2 / 3) * (p1.x - p2.x),
    y: p2.y + (2 / 3) * (p1.y - p2.y),
  }
  return flattenCubic(p0, c1, c2, p2, tol)
}

/** Approximate SVG elliptical arc as polyline. */
export function flattenArc(
  p0: Point,
  rx: number,
  ry: number,
  xAxisRotDeg: number,
  largeArc: boolean,
  sweep: boolean,
  p1: Point,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): Point[] {
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  if (rx < tol.abs || ry < tol.abs) return [p0, p1]

  const phi = (xAxisRotDeg * Math.PI) / 180
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)

  const dx = (p0.x - p1.x) / 2
  const dy = (p0.y - p1.y) / 2
  let x1p = cosPhi * dx + sinPhi * dy
  let y1p = -sinPhi * dx + cosPhi * dy

  let rxs = rx * rx
  let rys = ry * ry
  const x1ps = x1p * x1p
  const y1ps = y1p * y1p
  const lambda = x1ps / rxs + y1ps / rys
  if (lambda > 1) {
    const s = Math.sqrt(lambda)
    rx *= s
    ry *= s
    rxs = rx * rx
    rys = ry * ry
  }

  const sign = largeArc === sweep ? -1 : 1
  let sq =
    (rxs * rys - rxs * y1ps - rys * x1ps) / (rxs * y1ps + rys * x1ps)
  sq = Math.max(0, sq)
  const coef = sign * Math.sqrt(sq)
  const cxp = (coef * (rx * y1p)) / ry
  const cyp = (coef * -(ry * x1p)) / rx

  const cx = cosPhi * cxp - sinPhi * cyp + (p0.x + p1.x) / 2
  const cy = sinPhi * cxp + cosPhi * cyp + (p0.y + p1.y) / 2

  const ux = (x1p - cxp) / rx
  const uy = (y1p - cyp) / ry
  const vx = (-x1p - cxp) / rx
  const vy = (-y1p - cyp) / ry

  const n = Math.hypot(ux, uy)
  let startAng = Math.acos(Math.max(-1, Math.min(1, ux / n)))
  if (uy < 0) startAng = -startAng

  const n2 = Math.hypot(ux, uy) * Math.hypot(vx, vy)
  let dAng = Math.acos(
    Math.max(-1, Math.min(1, (ux * vx + uy * vy) / n2)),
  )
  if (ux * vy - uy * vx < 0) dAng = -dAng
  if (!sweep && dAng > 0) dAng -= 2 * Math.PI
  if (sweep && dAng < 0) dAng += 2 * Math.PI

  const steps = Math.max(
    2,
    Math.ceil(Math.abs(dAng) / Math.max(0.05, tol.curveTolerance / Math.max(rx, ry))),
  )
  const out: Point[] = [p0]
  for (let i = 1; i <= steps; i++) {
    const t = startAng + (dAng * i) / steps
    const x = cosPhi * rx * Math.cos(t) - sinPhi * ry * Math.sin(t) + cx
    const y = sinPhi * rx * Math.cos(t) + cosPhi * ry * Math.sin(t) + cy
    out.push({ x, y })
  }
  return out
}

function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}
