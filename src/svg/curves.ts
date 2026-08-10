import type { Point } from '../geometry'

function dist(a: Point, b: Point): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.hypot(dx, dy)
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/** Max distance from mid chord to curve control estimate (flatness). */
function cubicFlatness(p0: Point, p1: Point, p2: Point, p3: Point): number {
  const ux = 3 * p1.x - 2 * p0.x - p3.x
  const uy = 3 * p1.y - 2 * p0.y - p3.y
  const vx = 3 * p2.x - 2 * p3.x - p0.x
  const vy = 3 * p2.y - 2 * p3.y - p0.y
  return Math.max(ux * ux + uy * uy, vx * vx + vy * vy)
}

function quadraticFlatness(p0: Point, p1: Point, p2: Point): number {
  const ux = 2 * p1.x - p0.x - p2.x
  const uy = 2 * p1.y - p0.y - p2.y
  return ux * ux + uy * uy
}

/**
 * Approximate cubic Bézier into line segments.
 * `tolerance` is in the same units as the points (user units during parse).
 */
export function flattenCubic(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  tolerance: number,
  out: Point[],
): void {
  const tol2 = Math.max(tolerance, 1e-9) ** 2
  const recurse = (
    a: Point,
    b: Point,
    c: Point,
    d: Point,
    depth: number,
  ): void => {
    if (depth > 16 || cubicFlatness(a, b, c, d) <= 16 * tol2) {
      out.push(d)
      return
    }
    const ab = lerp(a, b, 0.5)
    const bc = lerp(b, c, 0.5)
    const cd = lerp(c, d, 0.5)
    const abc = lerp(ab, bc, 0.5)
    const bcd = lerp(bc, cd, 0.5)
    const mid = lerp(abc, bcd, 0.5)
    recurse(a, ab, abc, mid, depth + 1)
    recurse(mid, bcd, cd, d, depth + 1)
  }
  recurse(p0, p1, p2, p3, 0)
}

export function flattenQuadratic(
  p0: Point,
  p1: Point,
  p2: Point,
  tolerance: number,
  out: Point[],
): void {
  const tol2 = Math.max(tolerance, 1e-9) ** 2
  const recurse = (a: Point, b: Point, c: Point, depth: number): void => {
    if (depth > 16 || quadraticFlatness(a, b, c) <= tol2) {
      out.push(c)
      return
    }
    const ab = lerp(a, b, 0.5)
    const bc = lerp(b, c, 0.5)
    const mid = lerp(ab, bc, 0.5)
    recurse(a, ab, mid, depth + 1)
    recurse(mid, bc, c, depth + 1)
  }
  recurse(p0, p1, p2, 0)
}

/**
 * SVG elliptical arc → line segments (W3C endpoint-to-center parameterization).
 */
export function flattenArc(
  p0: Point,
  rx: number,
  ry: number,
  phiDeg: number,
  largeArc: boolean,
  sweep: boolean,
  p1: Point,
  tolerance: number,
  out: Point[],
): { ok: boolean; reason?: string } {
  if (pointsNear(p0, p1)) return { ok: true }

  rx = Math.abs(rx)
  ry = Math.abs(ry)
  if (rx < 1e-12 || ry < 1e-12) {
    out.push(p1)
    return { ok: true }
  }

  const phi = (phiDeg * Math.PI) / 180
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)

  const dx = (p0.x - p1.x) / 2
  const dy = (p0.y - p1.y) / 2
  const x1p = cosPhi * dx + sinPhi * dy
  const y1p = -sinPhi * dx + cosPhi * dy

  let rxSq = rx * rx
  let rySq = ry * ry
  const x1pSq = x1p * x1p
  const y1pSq = y1p * y1p

  const lam = x1pSq / rxSq + y1pSq / rySq
  if (lam > 1) {
    const s = Math.sqrt(lam)
    rx *= s
    ry *= s
    rxSq = rx * rx
    rySq = ry * ry
  }

  const num = rxSq * rySq - rxSq * y1pSq - rySq * x1pSq
  const den = rxSq * y1pSq + rySq * x1pSq
  if (den <= 0) {
    return { ok: false, reason: 'Degenerate arc denominator' }
  }
  let cFactor = Math.sqrt(Math.max(0, num / den))
  if (largeArc === sweep) cFactor = -cFactor

  const cxp = (cFactor * (rx * y1p)) / ry
  const cyp = (cFactor * (-ry * x1p)) / rx

  const cx = cosPhi * cxp - sinPhi * cyp + (p0.x + p1.x) / 2
  const cy = sinPhi * cxp + cosPhi * cyp + (p0.y + p1.y) / 2

  const theta1 = vectorAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let dTheta = vectorAngle(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry,
  )

  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI

  const radius = Math.max(rx, ry)
  const segTol = Math.max(tolerance, 1e-9)
  // angle step from sagitta ≈ r(1-cos(θ/2)) ≤ tol
  let step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - segTol / radius)))
  if (!Number.isFinite(step) || step < 1e-3) step = 1e-3
  const n = Math.max(1, Math.ceil(Math.abs(dTheta) / step))

  for (let i = 1; i <= n; i++) {
    const t = theta1 + (dTheta * i) / n
    const cosT = Math.cos(t)
    const sinT = Math.sin(t)
    out.push({
      x: cosPhi * rx * cosT - sinPhi * ry * sinT + cx,
      y: sinPhi * rx * cosT + cosPhi * ry * sinT + cy,
    })
  }
  // Ensure exact endpoint
  const last = out[out.length - 1]
  if (!last || !pointsNear(last, p1)) out.push(p1)
  else {
    last.x = p1.x
    last.y = p1.y
  }
  return { ok: true }
}

function pointsNear(a: Point, b: Point): boolean {
  return dist(a, b) < 1e-12
}

function vectorAngle(ux: number, uy: number, vx: number, vy: number): number {
  const sign = ux * vy - uy * vx < 0 ? -1 : 1
  const dot = ux * vx + uy * vy
  const uLen = Math.hypot(ux, uy)
  const vLen = Math.hypot(vx, vy)
  const cos = Math.max(-1, Math.min(1, dot / (uLen * vLen || 1)))
  return sign * Math.acos(cos)
}

/** Sample ellipse/circle into a closed ring (CCW in user space before flips). */
export function sampleEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  tolerance: number,
): Point[] {
  const r = Math.max(rx, ry, 1e-9)
  let step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tolerance / r)))
  if (!Number.isFinite(step) || step < 1e-3) step = 1e-3
  const n = Math.max(8, Math.ceil((2 * Math.PI) / step))
  const pts: Point[] = []
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n
    pts.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) })
  }
  return pts
}
