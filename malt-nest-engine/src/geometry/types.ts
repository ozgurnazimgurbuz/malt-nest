/** Coordinate unit: millimetres (mm). SVG user units are interpreted as mm. */
export type Point = { readonly x: number; readonly y: number }

export type Segment = { readonly a: Point; readonly b: Point }

/**
 * Closed ring: first point ≠ last (implicit close).
 * Winding (Y-down SVG space): signedArea > 0 ⇒ CCW in coordinate axes.
 */
export type Ring = readonly Point[]

/**
 * Simple polygon: one outer + zero or more holes.
 * Convention after normalize:
 * - outer: positive signed area (CCW)
 * - holes: negative signed area (CW)
 */
export type Polygon = {
  readonly outer: Ring
  readonly holes: readonly Ring[]
}

/**
 * A nestable part solid. Today: one polygon.
 * Multi-contour parts can become multiple polygons later.
 */
export type Shape = {
  readonly id: string
  readonly polygons: readonly Polygon[]
}

export type BoundingBox = {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

export function point(x: number, y: number): Point {
  return { x, y }
}

export function bboxWidth(b: BoundingBox): number {
  return b.maxX - b.minX
}

export function bboxHeight(b: BoundingBox): number {
  return b.maxY - b.minY
}

export function bboxArea(b: BoundingBox): number {
  return Math.max(0, bboxWidth(b)) * Math.max(0, bboxHeight(b))
}
