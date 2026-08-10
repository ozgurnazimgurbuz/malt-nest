import type { Point } from '../geometry'
import { sampleEllipse } from './curves'
import { flattenPathData, type Subpath } from './pathData'
import type { ParserWarning } from './warnings'

function num(el: Element, name: string, fallback = 0): number {
  const v = Number(el.getAttribute(name))
  return Number.isFinite(v) ? v : fallback
}

export function elementToSubpaths(
  el: Element,
  tolerance: number,
  warnings: ParserWarning[],
): Subpath[] {
  const tag = el.tagName.toLowerCase().replace(/^svg:/, '')

  switch (tag) {
    case 'rect': {
      const x = num(el, 'x')
      const y = num(el, 'y')
      const w = num(el, 'width')
      const h = num(el, 'height')
      if (w <= 0 || h <= 0) {
        warnings.push({
          code: 'empty_geometry',
          message: 'rect has non-positive size',
          element: 'rect',
        })
        return []
      }
      // rx/ry ignored for Stage 2 simplicity (sharp corners)
      const pts: Point[] = [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ]
      return [{ points: pts, closed: true }]
    }
    case 'circle': {
      const cx = num(el, 'cx')
      const cy = num(el, 'cy')
      const r = num(el, 'r')
      if (r <= 0) {
        warnings.push({
          code: 'empty_geometry',
          message: 'circle has non-positive radius',
          element: 'circle',
        })
        return []
      }
      return [{ points: sampleEllipse(cx, cy, r, r, tolerance), closed: true }]
    }
    case 'ellipse': {
      const cx = num(el, 'cx')
      const cy = num(el, 'cy')
      const rx = num(el, 'rx')
      const ry = num(el, 'ry')
      if (rx <= 0 || ry <= 0) {
        warnings.push({
          code: 'empty_geometry',
          message: 'ellipse has non-positive radii',
          element: 'ellipse',
        })
        return []
      }
      return [{ points: sampleEllipse(cx, cy, rx, ry, tolerance), closed: true }]
    }
    case 'polygon':
    case 'polyline': {
      const raw = el.getAttribute('points') ?? ''
      const nums = raw
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number)
      const pts: Point[] = []
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const x = nums[i]!
        const y = nums[i + 1]!
        if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y })
      }
      if (pts.length < 2) {
        warnings.push({
          code: 'empty_geometry',
          message: `${tag} has insufficient points`,
          element: tag,
        })
        return []
      }
      return [{ points: pts, closed: tag === 'polygon' }]
    }
    case 'line': {
      const x1 = num(el, 'x1')
      const y1 = num(el, 'y1')
      const x2 = num(el, 'x2')
      const y2 = num(el, 'y2')
      return [{ points: [{ x: x1, y: y1 }, { x: x2, y: y2 }], closed: false }]
    }
    case 'path': {
      const d = el.getAttribute('d')
      if (!d) {
        warnings.push({
          code: 'malformed_path',
          message: 'path missing d attribute',
          element: 'path',
        })
        return []
      }
      return flattenPathData(d, tolerance, warnings, 'path')
    }
    default:
      return []
  }
}
