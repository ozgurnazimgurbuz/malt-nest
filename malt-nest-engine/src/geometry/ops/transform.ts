import type { Point, Polygon, Ring, Shape } from '../types'

function mapRing(ring: Ring, f: (p: Point) => Point): Ring {
  return ring.map(f)
}

function mapPolygon(poly: Polygon, f: (p: Point) => Point): Polygon {
  return {
    outer: mapRing(poly.outer, f),
    holes: poly.holes.map((h) => mapRing(h, f)),
  }
}

export function translateShape(shape: Shape, dx: number, dy: number): Shape {
  const f = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy })
  return {
    id: shape.id,
    polygons: shape.polygons.map((poly) => mapPolygon(poly, f)),
  }
}

/** Rotate around origin (0,0), degrees, CCW in coordinate axes. */
export function rotateShape(shape: Shape, deg: number): Shape {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  const f = (p: Point): Point => ({
    x: p.x * c - p.y * s,
    y: p.x * s + p.y * c,
  })
  return {
    id: shape.id,
    polygons: shape.polygons.map((poly) => mapPolygon(poly, f)),
  }
}

/** Rotate around an arbitrary pivot. */
export function rotateShapeAround(
  shape: Shape,
  deg: number,
  pivot: Point,
): Shape {
  return translateShape(
    rotateShape(translateShape(shape, -pivot.x, -pivot.y), deg),
    pivot.x,
    pivot.y,
  )
}

export function scaleShape(
  shape: Shape,
  sx: number,
  sy: number = sx,
): Shape {
  const f = (p: Point): Point => ({ x: p.x * sx, y: p.y * sy })
  return {
    id: shape.id,
    polygons: shape.polygons.map((poly) => mapPolygon(poly, f)),
  }
}

export function translateRing(ring: Ring, dx: number, dy: number): Ring {
  return ring.map((p) => ({ x: p.x + dx, y: p.y + dy }))
}

export function rotateRing(ring: Ring, deg: number): Ring {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return ring.map((p) => ({
    x: p.x * c - p.y * s,
    y: p.x * s + p.y * c,
  }))
}
