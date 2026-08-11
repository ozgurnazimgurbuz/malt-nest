import { Window } from 'happy-dom'
import { absoluteArea } from '../ring'
import { makeShape, normalizeShape } from '../shape'
import type { Ring, Shape } from '../types'
import {
  DEFAULT_TOLERANCE,
  type GeometryTolerance,
} from '../tolerance'
import { pathToRings } from './path'
import { flattenArc } from './flatten'

export type SvgParseOptions = {
  tolerance?: GeometryTolerance
  idPrefix?: string
}

export type SvgParseResult = {
  shapes: Shape[]
  meta: {
    shapeCount: number
    ringCount: number
    holeCount: number
    hasCurves: boolean
    parseMs: number
  }
}

function attr(el: Element, name: string, fallback = ''): string {
  return el.getAttribute(name) ?? fallback
}

function numAttr(el: Element, name: string, fallback = 0): number {
  const v = Number(attr(el, name, String(fallback)))
  return Number.isFinite(v) ? v : fallback
}

function parsePoints(points: string): Ring {
  const nums = points
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n))
  const ring: { x: number; y: number }[] = []
  for (let i = 0; i + 1 < nums.length; i += 2) {
    ring.push({ x: nums[i]!, y: nums[i + 1]! })
  }
  return ring
}

function circleRing(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  tol: GeometryTolerance,
): Ring {
  const half = flattenArc(
    { x: cx + rx, y: cy },
    rx,
    ry,
    0,
    false,
    true,
    { x: cx - rx, y: cy },
    tol,
  )
  const half2 = flattenArc(
    { x: cx - rx, y: cy },
    rx,
    ry,
    0,
    false,
    true,
    { x: cx + rx, y: cy },
    tol,
  )
  return [...half.slice(0, -1), ...half2.slice(0, -1)]
}

function ringsToShapes(
  rings: Ring[],
  idBase: string,
  tol: GeometryTolerance,
): Shape[] {
  if (rings.length === 0) return []
  const ranked = rings
    .map((r) => ({ r, a: absoluteArea(r) }))
    .sort((a, b) => b.a - a.a)
  const outer = ranked[0]!.r
  const holes = ranked.slice(1).map((x) => x.r)
  return [normalizeShape(makeShape(idBase, outer, holes), tol)]
}

function parseSvgDocument(svgText: string): Document {
  if (typeof DOMParser !== 'undefined') {
    return new DOMParser().parseFromString(svgText, 'image/svg+xml')
  }
  const window = new Window()
  window.document.write(svgText)
  return window.document as unknown as Document
}

/**
 * Parse SVG markup → normalized Shapes (geometry only; no nest config).
 */
export function parseSvg(
  svgText: string,
  options: SvgParseOptions = {},
): SvgParseResult {
  const t0 = performance.now()
  const tol = options.tolerance ?? DEFAULT_TOLERANCE
  const prefix = options.idPrefix ?? 'shape'
  const shapes: Shape[] = []
  let hasCurves = /[CcSsQqTtAa]/.test(svgText)
  let ringCount = 0
  let holeCount = 0
  let id = 0

  const root = parseSvgDocument(svgText).documentElement
  if (!root) {
    return {
      shapes: [],
      meta: {
        shapeCount: 0,
        ringCount: 0,
        holeCount: 0,
        hasCurves,
        parseMs: performance.now() - t0,
      },
    }
  }

  const visit = (el: Element) => {
    const tag = el.tagName.toLowerCase().replace(/^.*:/, '')
    if (tag === 'rect') {
      const x = numAttr(el, 'x')
      const y = numAttr(el, 'y')
      const w = numAttr(el, 'width')
      const h = numAttr(el, 'height')
      if (w > 0 && h > 0) {
        const ring: Ring = [
          { x, y },
          { x: x + w, y },
          { x: x + w, y: y + h },
          { x, y: y + h },
        ]
        shapes.push(normalizeShape(makeShape(`${prefix}-${id++}`, ring), tol))
        ringCount++
      }
    } else if (tag === 'polygon' || tag === 'polyline') {
      const ring = parsePoints(attr(el, 'points'))
      if (ring.length >= 3) {
        shapes.push(normalizeShape(makeShape(`${prefix}-${id++}`, ring), tol))
        ringCount++
      }
    } else if (tag === 'circle') {
      const cx = numAttr(el, 'cx')
      const cy = numAttr(el, 'cy')
      const r = numAttr(el, 'r')
      if (r > 0) {
        hasCurves = true
        const ct = {
          ...tol,
          curveTolerance: Math.min(tol.curveTolerance, Math.max(r / 48, 0.05)),
        }
        shapes.push(
          normalizeShape(
            makeShape(`${prefix}-${id++}`, circleRing(cx, cy, r, r, ct)),
            tol,
          ),
        )
        ringCount++
      }
    } else if (tag === 'ellipse') {
      const cx = numAttr(el, 'cx')
      const cy = numAttr(el, 'cy')
      const rx = numAttr(el, 'rx')
      const ry = numAttr(el, 'ry')
      if (rx > 0 && ry > 0) {
        hasCurves = true
        shapes.push(
          normalizeShape(
            makeShape(`${prefix}-${id++}`, circleRing(cx, cy, rx, ry, tol)),
            tol,
          ),
        )
        ringCount++
      }
    } else if (tag === 'path') {
      const d = attr(el, 'd')
      if (d) {
        const rings = pathToRings(d, tol)
        for (const s of ringsToShapes(rings, `${prefix}-${id++}`, tol)) {
          shapes.push(s)
          const holes = s.polygons[0]?.holes.length ?? 0
          ringCount += 1 + holes
          holeCount += holes
        }
      }
    }

    for (const child of Array.from(el.children)) {
      visit(child as Element)
    }
  }

  visit(root)

  return {
    shapes,
    meta: {
      shapeCount: shapes.length,
      ringCount,
      holeCount,
      hasCurves,
      parseMs: performance.now() - t0,
    },
  }
}
