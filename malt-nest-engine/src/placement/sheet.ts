import type { Point } from '../geometry/types'
import {
  DEFAULT_TOLERANCE,
  nearlyEqual,
  type GeometryTolerance,
} from '../geometry/tolerance'
import type { Sheet, UsableRegion } from './types'

export function createSheet(
  width: number,
  height: number,
  margin = 0,
): Sheet {
  if (![width, height, margin].every(Number.isFinite)) {
    throw new Error('Sheet width, height, and margin must be finite')
  }
  if (!(width > 0) || !(height > 0)) {
    throw new Error('Sheet width/height must be positive')
  }
  if (margin < 0) throw new Error('Sheet margin must be ≥ 0')
  if (2 * margin >= width || 2 * margin >= height) {
    throw new Error('Sheet margin leaves no usable area')
  }
  return { width, height, margin }
}

export function usableRegion(sheet: Sheet): UsableRegion {
  const m = sheet.margin
  return {
    minX: m,
    minY: m,
    maxX: sheet.width - m,
    maxY: sheet.height - m,
  }
}

export function usableWidth(sheet: Sheet): number {
  return sheet.width - 2 * sheet.margin
}

export function usableHeight(sheet: Sheet): number {
  return sheet.height - 2 * sheet.margin
}

/** Point inside usable region (boundary inclusive within tolerance). */
export function pointInUsableRegion(
  p: Point,
  region: UsableRegion,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): boolean {
  return (
    p.x >= region.minX - tol.abs &&
    p.x <= region.maxX + tol.abs &&
    p.y >= region.minY - tol.abs &&
    p.y <= region.maxY + tol.abs
  )
}

export function regionsEqual(
  a: UsableRegion,
  b: UsableRegion,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): boolean {
  return (
    nearlyEqual(a.minX, b.minX, tol) &&
    nearlyEqual(a.minY, b.minY, tol) &&
    nearlyEqual(a.maxX, b.maxX, tol) &&
    nearlyEqual(a.maxY, b.maxY, tol)
  )
}
