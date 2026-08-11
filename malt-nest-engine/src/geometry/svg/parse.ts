import { Window } from 'happy-dom'
import { absoluteArea, signedArea } from '../ring'
import { polygonContainsPolygon } from '../ops/relate'
import { makeShape, normalizeShape } from '../shape'
import type { Ring, Shape } from '../types'
import {
  DEFAULT_TOLERANCE,
  type GeometryTolerance,
} from '../tolerance'
import { pathToRings } from './path'
import { flattenArc } from './flatten'
import {
  IDENTITY,
  maxScale,
  multiply,
  parseTransform,
  transformRing,
  type Matrix,
} from './matrix'

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

type SvgFillRule = 'nonzero' | 'evenodd'

function attr(el: Element, name: string, fallback = ''): string {
  return el.getAttribute(name) ?? fallback
}

function numAttr(el: Element, name: string, fallback = 0): number {
  const raw = el.getAttribute(name)
  if (raw === null) return fallback
  const value = raw.trim()
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) {
    throw new Error(`Invalid SVG number in ${name} attribute`)
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid SVG number in ${name} attribute`)
  }
  return parsed
}

function parsePoints(points: string): Ring {
  const numberPattern = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g
  const nums: number[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = numberPattern.exec(points))) {
    if (!/^[\s,]*$/.test(points.slice(cursor, match.index))) {
      throw new Error('Invalid SVG points list')
    }
    const value = Number(match[0])
    if (!Number.isFinite(value)) {
      throw new Error('Invalid SVG number in points list')
    }
    nums.push(value)
    cursor = numberPattern.lastIndex
  }
  if (!/^[\s,]*$/.test(points.slice(cursor)) || nums.length % 2 !== 0) {
    throw new Error('Invalid SVG points list')
  }
  const ring: { x: number; y: number }[] = []
  for (let i = 0; i + 1 < nums.length; i += 2) {
    ring.push({ x: nums[i]!, y: nums[i + 1]! })
  }
  return ring
}

function resolveFillRule(el: Element, inherited: SvgFillRule): SvgFillRule {
  const attribute = el.getAttribute('fill-rule')?.trim().toLowerCase()
  if (attribute === 'evenodd' || attribute === 'nonzero') return attribute
  const style = el.getAttribute('style') ?? ''
  const inline = /(?:^|;)\s*fill-rule\s*:\s*(evenodd|nonzero)\b/i.exec(style)
  return (inline?.[1]?.toLowerCase() as SvgFillRule | undefined) ?? inherited
}

function localCurveTolerance(
  tol: GeometryTolerance,
  matrix: Matrix,
): GeometryTolerance {
  const scale = maxScale(matrix)
  if (scale <= 1) return tol
  return { ...tol, curveTolerance: tol.curveTolerance / scale }
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
  fillRule: SvgFillRule,
): Shape[] {
  if (rings.length === 0) return []

  type RingNode = {
    ring: Ring
    area: number
    parent: number | null
    children: number[]
  }

  const nodes: RingNode[] = []
  const ranked = rings
    .map((ring) => ({ ring, area: absoluteArea(ring) }))
    .sort((a, b) => b.area - a.area)

  for (const candidate of ranked) {
    let parent: number | null = null
    for (let i = 0; i < nodes.length; i++) {
      const container = nodes[i]!
      if (
        polygonContainsPolygon(
          { outer: container.ring, holes: [] },
          { outer: candidate.ring, holes: [] },
          tol,
        ) &&
        (parent === null || container.area < nodes[parent]!.area)
      ) {
        parent = i
      }
    }
    nodes.push({
      ...candidate,
      parent,
      children: [],
    })
    if (parent !== null) nodes[parent]!.children.push(nodes.length - 1)
  }

  const polygons: { outer: Ring; holes: Ring[] }[] = []
  const isFilled = (winding: number) =>
    fillRule === 'evenodd'
      ? Math.abs(winding) % 2 === 1
      : winding !== 0
  type Frame = {
    index: number
    parentWinding: number
    activePolygon: { outer: Ring; holes: Ring[] } | null
  }
  const stack: Frame[] = []
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (nodes[i]!.parent === null) {
      stack.push({ index: i, parentWinding: 0, activePolygon: null })
    }
  }
  while (stack.length > 0) {
    const frame = stack.pop()!
    const node = nodes[frame.index]!
    const delta = fillRule === 'evenodd' ? 1 : Math.sign(signedArea(node.ring))
    const winding = frame.parentWinding + delta
    const parentFilled = isFilled(frame.parentWinding)
    const filled = isFilled(winding)
    let activePolygon = frame.activePolygon
    if (!parentFilled && filled) {
      activePolygon = { outer: node.ring, holes: [] }
      polygons.push(activePolygon)
    } else if (parentFilled && !filled) {
      activePolygon?.holes.push(node.ring)
      activePolygon = null
    }
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push({
        index: node.children[i]!,
        parentWinding: winding,
        activePolygon,
      })
    }
  }

  return [normalizeShape({ id: idBase, polygons }, tol)]
}

function parseSvgDocument(svgText: string): Document {
  let document: Document
  if (typeof DOMParser !== 'undefined') {
    document = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  } else {
    const window = new Window()
    document = new window.DOMParser().parseFromString(
      svgText,
      'image/svg+xml',
    ) as unknown as Document
  }
  const root = document.documentElement
  if (root) {
    const stack: Element[] = [root]
    while (stack.length > 0) {
      const element = stack.pop()!
      if (element.tagName.toLowerCase().replace(/^.*:/, '') === 'parsererror') {
        throw new Error('Malformed SVG document')
      }
      const children = Array.from(element.children)
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push(children[i] as Element)
      }
    }
  }
  return document
}

const NON_RENDERED_CONTAINERS = new Set(['defs', 'clippath', 'mask', 'symbol'])

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
  let hasCurves = false
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

  type Frame = {
    el: Element
    parentMatrix: Matrix
    inheritedFillRule: SvgFillRule
  }
  const stack: Frame[] = [
    { el: root, parentMatrix: IDENTITY, inheritedFillRule: 'nonzero' },
  ]

  while (stack.length > 0) {
    const { el, parentMatrix, inheritedFillRule } = stack.pop()!
    const tag = el.tagName.toLowerCase().replace(/^.*:/, '')
    if (NON_RENDERED_CONTAINERS.has(tag)) continue

    const matrix = multiply(parentMatrix, parseTransform(el.getAttribute('transform')))
    const fillRule = resolveFillRule(el, inheritedFillRule)
    const curveTolerance = localCurveTolerance(tol, matrix)
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
        shapes.push(
          normalizeShape(
            makeShape(`${prefix}-${id++}`, transformRing(matrix, ring)),
            tol,
          ),
        )
        ringCount++
      }
    } else if (tag === 'polygon' || tag === 'polyline') {
      const ring = parsePoints(attr(el, 'points'))
      if (ring.length >= 3) {
        shapes.push(
          normalizeShape(
            makeShape(`${prefix}-${id++}`, transformRing(matrix, ring)),
            tol,
          ),
        )
        ringCount++
      }
    } else if (tag === 'circle') {
      const cx = numAttr(el, 'cx')
      const cy = numAttr(el, 'cy')
      const r = numAttr(el, 'r')
      if (r > 0) {
        hasCurves = true
        const ct = {
          ...curveTolerance,
          curveTolerance: Math.min(
            curveTolerance.curveTolerance,
            Math.max(r / 48, 0.05),
          ),
        }
        shapes.push(
          normalizeShape(
            makeShape(
              `${prefix}-${id++}`,
              transformRing(matrix, circleRing(cx, cy, r, r, ct)),
            ),
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
            makeShape(
              `${prefix}-${id++}`,
              transformRing(
                matrix,
                circleRing(cx, cy, rx, ry, curveTolerance),
              ),
            ),
            tol,
          ),
        )
        ringCount++
      }
    } else if (tag === 'path') {
      const d = attr(el, 'd')
      if (d) {
        const rings = pathToRings(d, curveTolerance).map((ring) =>
          transformRing(matrix, ring),
        )
        const parsedShapes = ringsToShapes(
          rings,
          `${prefix}-${id}`,
          tol,
          fillRule,
        )
        if (parsedShapes.length > 0) id++
        if (parsedShapes.length > 0 && /[CcSsQqTtAa]/.test(d)) hasCurves = true
        for (const s of parsedShapes) {
          shapes.push(s)
          const ringsInShape = s.polygons.reduce(
            (count, polygon) => count + 1 + polygon.holes.length,
            0,
          )
          const holes = s.polygons.reduce(
            (count, polygon) => count + polygon.holes.length,
            0,
          )
          ringCount += ringsInShape
          holeCount += holes
        }
      }
    }

    const children = Array.from(el.children)
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({
        el: children[i] as Element,
        parentMatrix: matrix,
        inheritedFillRule: fillRule,
      })
    }
  }

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
