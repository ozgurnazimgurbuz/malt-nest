/**
 * Engine-agnostic 2D geometry (mm).
 *
 * Winding convention (normalized after parse):
 * - Outer contours: counter-clockwise (positive shoelace area)
 * - Holes: clockwise (negative shoelace area)
 */

export type Point = {
  x: number
  y: number
}

export type Segment = {
  a: Point
  b: Point
}

/** Closed ring — may be outer (CCW) or hole (CW). */
export type Contour = {
  points: Point[]
}

export type Polygon = {
  points: Point[]
}

/** Outer + holes as one solid region. */
export type MultiPolygon = {
  outer: Polygon
  holes: Polygon[]
}

export type BoundingBox = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

export type PartId = string

export type GeometryPart = {
  id: PartId
  sourceElement: string
  originalIndex: number
  sourceId: string | null
  outer: Polygon
  holes: Polygon[]
  boundingBox: BoundingBox
  area: number
  centroid: Point
  /** SVG transform attribute chain as seen on the element (debug). */
  originalTransform: string | null
}

/** @deprecated Use GeometryPart — kept as alias for nesting stubs. */
export type Part = GeometryPart

export type Bounds = Pick<BoundingBox, 'minX' | 'minY' | 'maxX' | 'maxY'>

export type Transform2D = {
  rotationDeg: number
  tx: number
  ty: number
  origin: Point
}
