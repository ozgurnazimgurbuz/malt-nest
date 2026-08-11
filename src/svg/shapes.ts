import type { Point } from '../geometry'
import { flattenArc, sampleEllipse } from './curves'
import { flattenPathData, type Subpath } from './pathData'
import type { ParserWarning } from './warnings'

const SVG_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

function num(
  el: Element,
  name: string,
  warnings: ParserWarning[],
  fallback = 0,
): number | null {
  const raw = el.getAttribute(name)
  if (raw === null || raw.trim() === '') return fallback
  const value = raw.trim()
  const parsed = Number(value)
  if (SVG_NUMBER.test(value) && Number.isFinite(parsed)) return parsed
  const element = el.tagName.toLowerCase().replace(/^svg:/, '')
  warnings.push({
    code: 'empty_geometry',
    message: `<${element}> has invalid ${name} attribute`,
    element,
  })
  return null
}

function pointList(
  el: Element,
  warnings: ParserWarning[],
): Point[] | null {
  const raw = el.getAttribute('points') ?? ''
  const pattern = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g
  const values: number[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(raw))) {
    if (!/^[\s,]*$/.test(raw.slice(cursor, match.index))) break
    values.push(Number(match[0]))
    cursor = pattern.lastIndex
  }
  if (
    !/^[\s,]*$/.test(raw.slice(cursor)) ||
    values.length % 2 !== 0 ||
    values.some((value) => !Number.isFinite(value))
  ) {
    const element = el.tagName.toLowerCase().replace(/^svg:/, '')
    warnings.push({
      code: 'empty_geometry',
      message: `<${element}> has an invalid points list`,
      element,
    })
    return null
  }
  const points: Point[] = []
  for (let i = 0; i < values.length; i += 2) {
    points.push({ x: values[i]!, y: values[i + 1]! })
  }
  return points
}

function roundedRect(
  x: number,
  y: number,
  width: number,
  height: number,
  rx: number,
  ry: number,
  tolerance: number,
): Point[] {
  const points: Point[] = [{ x: x + rx, y }]
  const line = (px: number, py: number) => points.push({ x: px, y: py })
  const arc = (px: number, py: number) => {
    flattenArc(
      points[points.length - 1]!,
      rx,
      ry,
      0,
      false,
      true,
      { x: px, y: py },
      tolerance,
      points,
    )
  }
  line(x + width - rx, y)
  arc(x + width, y + ry)
  line(x + width, y + height - ry)
  arc(x + width - rx, y + height)
  line(x + rx, y + height)
  arc(x, y + height - ry)
  line(x, y + ry)
  arc(x + rx, y)
  points.pop() // closed-ring duplicate
  return points
}

export function elementToSubpaths(
  el: Element,
  tolerance: number,
  warnings: ParserWarning[],
): Subpath[] {
  const tag = el.tagName.toLowerCase().replace(/^svg:/, '')

  switch (tag) {
    case 'rect': {
      const x = num(el, 'x', warnings)
      const y = num(el, 'y', warnings)
      const w = num(el, 'width', warnings)
      const h = num(el, 'height', warnings)
      if (x === null || y === null || w === null || h === null) return []
      if (w <= 0 || h <= 0) {
        warnings.push({
          code: 'empty_geometry',
          message: 'rect has non-positive size',
          element: 'rect',
        })
        return []
      }
      const hasRx = el.hasAttribute('rx')
      const hasRy = el.hasAttribute('ry')
      const parsedRx = hasRx ? num(el, 'rx', warnings) : undefined
      const parsedRy = hasRy ? num(el, 'ry', warnings) : undefined
      if (parsedRx === null || parsedRy === null) return []
      let rx = parsedRx ?? parsedRy ?? 0
      let ry = parsedRy ?? parsedRx ?? 0
      if (rx < 0 || ry < 0) {
        warnings.push({
          code: 'empty_geometry',
          message: 'rect has negative corner radius',
          element: 'rect',
        })
        return []
      }
      rx = Math.min(rx, w / 2)
      ry = Math.min(ry, h / 2)
      if (rx > 0 && ry > 0) {
        return [{ points: roundedRect(x, y, w, h, rx, ry, tolerance), closed: true }]
      }
      const pts: Point[] = [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ]
      return [{ points: pts, closed: true }]
    }
    case 'circle': {
      const cx = num(el, 'cx', warnings)
      const cy = num(el, 'cy', warnings)
      const r = num(el, 'r', warnings)
      if (cx === null || cy === null || r === null) return []
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
      const cx = num(el, 'cx', warnings)
      const cy = num(el, 'cy', warnings)
      const rx = num(el, 'rx', warnings)
      const ry = num(el, 'ry', warnings)
      if (cx === null || cy === null || rx === null || ry === null) return []
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
      const pts = pointList(el, warnings)
      if (!pts) return []
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
      const x1 = num(el, 'x1', warnings)
      const y1 = num(el, 'y1', warnings)
      const x2 = num(el, 'x2', warnings)
      const y2 = num(el, 'y2', warnings)
      if (x1 === null || y1 === null || x2 === null || y2 === null) return []
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
