import type { Point } from '../geometry'
import type { ParserWarning } from './warnings'

/** Affine 2D matrix: x' = a*x + c*y + e ; y' = b*x + d*y + f */
export type Matrix = {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

export function multiply(m1: Matrix, m2: Matrix): Matrix {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  }
}

export function translate(tx: number, ty: number): Matrix {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }
}

export function scale(sx: number, sy: number): Matrix {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }
}

export function rotate(deg: number, cx = 0, cy = 0): Matrix {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const r: Matrix = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 }
  if (cx === 0 && cy === 0) return r
  return multiply(translate(cx, cy), multiply(r, translate(-cx, -cy)))
}

export function applyMatrix(m: Matrix, p: Point): Point {
  return {
    x: m.a * p.x + m.c * p.y + m.e,
    y: m.b * p.x + m.d * p.y + m.f,
  }
}

export function applyMatrixToPoints(m: Matrix, points: Point[]): Point[] {
  return points.map((p) => applyMatrix(m, p))
}

const TRANSFORM_RE =
  /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/gi

function nums(args: string): number[] | null {
  const pattern = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g
  const values: number[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(args))) {
    if (!/^[\s,]*$/.test(args.slice(cursor, match.index))) return null
    const value = Number(match[0])
    if (!Number.isFinite(value)) return null
    values.push(value)
    cursor = pattern.lastIndex
  }
  return /^[\s,]*$/.test(args.slice(cursor)) ? values : null
}

/**
 * Parse SVG transform attribute into a matrix.
 * Returns null when any part of the transform list is malformed. Applying a
 * partial transform would silently nest geometry at the wrong coordinates.
 */
export function parseTransform(
  value: string | null,
  warnings: ParserWarning[],
  element?: string,
): Matrix | null {
  if (!value || !value.trim()) return IDENTITY
  let m = IDENTITY
  let cursor = 0
  const re = new RegExp(TRANSFORM_RE.source, 'gi')
  let match: RegExpExecArray | null
  const malformed = (message: string): null => {
    warnings.push({
      code: 'unsupported_transform',
      message,
      element,
    })
    return null
  }
  while ((match = re.exec(value)) !== null) {
    if (!/^[\s,]*$/.test(value.slice(cursor, match.index))) {
      return malformed(`Unrecognized transform syntax: ${value}`)
    }
    const kind = match[1]!.toLowerCase()
    const args = nums(match[2] ?? '')
    if (!args) return malformed(`Malformed transform: ${match[0]}`)
    let next: Matrix | null = null
    switch (kind) {
      case 'matrix':
        if (args.length === 6) {
          next = {
            a: args[0]!,
            b: args[1]!,
            c: args[2]!,
            d: args[3]!,
            e: args[4]!,
            f: args[5]!,
          }
        }
        break
      case 'translate':
        if (args.length === 1 || args.length === 2) {
          next = translate(args[0]!, args[1] ?? 0)
        }
        break
      case 'scale':
        if (args.length === 1 || args.length === 2) {
          next = scale(args[0]!, args[1] ?? args[0]!)
        }
        break
      case 'rotate':
        if (args.length === 1 || args.length === 3) {
          next = rotate(args[0]!, args[1] ?? 0, args[2] ?? 0)
        }
        break
      case 'skewx': {
        if (args.length === 1) {
          const tangent = Math.tan((args[0]! * Math.PI) / 180)
          if (Number.isFinite(tangent)) {
            next = { a: 1, b: 0, c: tangent, d: 1, e: 0, f: 0 }
          }
        }
        break
      }
      case 'skewy': {
        if (args.length === 1) {
          const tangent = Math.tan((args[0]! * Math.PI) / 180)
          if (Number.isFinite(tangent)) {
            next = { a: 1, b: tangent, c: 0, d: 1, e: 0, f: 0 }
          }
        }
        break
      }
      default:
        break
    }
    if (next) m = multiply(m, next)
    else return malformed(`Malformed transform: ${match[0]}`)
    cursor = re.lastIndex
  }
  if (cursor === 0 || !/^[\s,]*$/.test(value.slice(cursor))) {
    return malformed(`Unrecognized transform syntax: ${value}`)
  }
  return m
}
