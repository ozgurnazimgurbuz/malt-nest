import type { Point, Ring } from '../types'

/** SVG affine matrix: x' = ax + cy + e; y' = bx + dy + f. */
export type Matrix = {
  readonly a: number
  readonly b: number
  readonly c: number
  readonly d: number
  readonly e: number
  readonly f: number
}

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

export function multiply(left: Matrix, right: Matrix): Matrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  }
}

/** Largest linear stretch factor (maximum singular value). */
export function maxScale(matrix: Matrix): number {
  const sum =
    matrix.a * matrix.a +
    matrix.b * matrix.b +
    matrix.c * matrix.c +
    matrix.d * matrix.d
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c
  const discriminant = Math.max(0, sum * sum - 4 * determinant * determinant)
  return Math.sqrt((sum + Math.sqrt(discriminant)) / 2)
}

function translate(tx: number, ty: number): Matrix {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }
}

function scale(sx: number, sy: number): Matrix {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }
}

function rotate(degrees: number, cx = 0, cy = 0): Matrix {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const rotation = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 }
  return multiply(
    translate(cx, cy),
    multiply(rotation, translate(-cx, -cy)),
  )
}

function parseNumbers(value: string): number[] {
  const numberPattern = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g
  const numbers: number[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = numberPattern.exec(value))) {
    if (!/^[\s,]*$/.test(value.slice(cursor, match.index))) {
      throw new Error('Invalid SVG transform arguments')
    }
    numbers.push(Number(match[0]))
    cursor = numberPattern.lastIndex
  }
  if (!/^[\s,]*$/.test(value.slice(cursor))) {
    throw new Error('Invalid SVG transform arguments')
  }
  return numbers
}

function expectArity(
  kind: string,
  values: number[],
  allowed: readonly number[],
): void {
  if (
    !allowed.includes(values.length) ||
    values.some((value) => !Number.isFinite(value))
  ) {
    throw new Error(`Invalid SVG ${kind} transform`)
  }
}

function transformMatrix(kind: string, values: number[]): Matrix {
  switch (kind.toLowerCase()) {
    case 'matrix':
      expectArity(kind, values, [6])
      return {
        a: values[0]!,
        b: values[1]!,
        c: values[2]!,
        d: values[3]!,
        e: values[4]!,
        f: values[5]!,
      }
    case 'translate':
      expectArity(kind, values, [1, 2])
      return translate(values[0]!, values[1] ?? 0)
    case 'scale':
      expectArity(kind, values, [1, 2])
      return scale(values[0]!, values[1] ?? values[0]!)
    case 'rotate':
      expectArity(kind, values, [1, 3])
      return rotate(values[0]!, values[1] ?? 0, values[2] ?? 0)
    case 'skewx': {
      expectArity(kind, values, [1])
      const tangent = Math.tan((values[0]! * Math.PI) / 180)
      if (!Number.isFinite(tangent)) throw new Error('Invalid SVG skewX transform')
      return { a: 1, b: 0, c: tangent, d: 1, e: 0, f: 0 }
    }
    case 'skewy': {
      expectArity(kind, values, [1])
      const tangent = Math.tan((values[0]! * Math.PI) / 180)
      if (!Number.isFinite(tangent)) throw new Error('Invalid SVG skewY transform')
      return { a: 1, b: tangent, c: 0, d: 1, e: 0, f: 0 }
    }
    default:
      throw new Error(`Unsupported SVG transform: ${kind}`)
  }
}

export function parseTransform(value: string | null): Matrix {
  if (!value?.trim()) return IDENTITY

  const transformPattern =
    /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/gi
  let result = IDENTITY
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = transformPattern.exec(value))) {
    if (!/^[\s,]*$/.test(value.slice(cursor, match.index))) {
      throw new Error('Invalid SVG transform syntax')
    }
    const next = transformMatrix(match[1]!, parseNumbers(match[2] ?? ''))
    result = multiply(result, next)
    cursor = transformPattern.lastIndex
  }
  if (cursor === 0 || !/^[\s,]*$/.test(value.slice(cursor))) {
    throw new Error('Invalid SVG transform syntax')
  }
  return result
}

export function transformPoint(matrix: Matrix, point: Point): Point {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  }
}

export function transformRing(matrix: Matrix, ring: Ring): Ring {
  return ring.map((point) => transformPoint(matrix, point))
}
