import type { Point } from '../../geometry'

/**
 * Nesting / NestPreview coordinates → SVG document coordinates.
 *
 * Malt Nest uses the same convention as SVG for sheet space:
 * origin top-left of the sheet, X right, Y down (mm).
 * NestPreview renders placements directly into viewBox="0 0 W H".
 *
 * This layer is therefore identity today — kept explicit so a future
 * Y-up nesting change cannot silently desync export from preview.
 */
export function nestToSvgPoint(p: Point, _sheetHeightMm: number): Point {
  return { x: p.x, y: p.y }
}

export function nestToSvgPoints(
  points: Point[],
  sheetHeightMm: number,
): Point[] {
  return points.map((p) => nestToSvgPoint(p, sheetHeightMm))
}
