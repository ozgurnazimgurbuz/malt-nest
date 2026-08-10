import type { BoundingBox, GeometryPart, Point } from '../geometry'
import { boundingBox, centroid, netArea, unionBounds } from '../geometry'
import { classifySubpaths } from './contours'
import {
  applyMatrixToPoints,
  multiply,
  parseTransform,
  type Matrix,
} from './matrix'
import { elementToSubpaths } from './shapes'
import { resolveUserToMm, type UserToMm } from './units'
import type { ParserWarning } from './warnings'

export type ParseGeometryOptions = {
  /** Curve/arc approximation tolerance in millimeters. Default 0.25mm. */
  curveToleranceMm?: number
}

export type SvgGeometryDocument = {
  parts: GeometryPart[]
  warnings: ParserWarning[]
  bounds: BoundingBox | null
  totalArea: number
  widthMm: number | null
  heightMm: number | null
  partCount: number
}

const SKIP_TAGS = new Set([
  'defs',
  'metadata',
  'title',
  'desc',
  'style',
  'script',
  'clippath',
  'mask',
  'symbol',
  'marker',
  'lineargradient',
  'radialgradient',
  'pattern',
  'filter',
])

const SHAPE_TAGS = new Set([
  'rect',
  'circle',
  'ellipse',
  'polygon',
  'polyline',
  'line',
  'path',
])

const CONTAINER_TAGS = new Set(['svg', 'g', 'a', 'switch'])

function tagName(el: Element): string {
  return el.tagName.toLowerCase().replace(/^svg:/, '')
}

function toMmPoints(points: Point[], scale: UserToMm): Point[] {
  const ox = scale.viewBox?.minX ?? 0
  const oy = scale.viewBox?.minY ?? 0
  return points.map((p) => ({
    x: (p.x - ox) * scale.sx,
    y: (p.y - oy) * scale.sy,
  }))
}

function makePart(
  outerUser: Point[],
  holesUser: Point[][],
  scale: UserToMm,
  meta: {
    sourceElement: string
    originalIndex: number
    sourceId: string | null
    originalTransform: string | null
  },
): GeometryPart | null {
  const outerPts = toMmPoints(outerUser, scale)
  if (outerPts.length < 2) return null
  const holes = holesUser
    .map((h) => ({ points: toMmPoints(h, scale) }))
    .filter((h) => h.points.length >= 3)
  const all = [...outerPts, ...holes.flatMap((h) => h.points)]
  const box = boundingBox(all)
  const area = netArea({ points: outerPts }, holes)
  return {
    id: `part-${meta.originalIndex}`,
    sourceElement: meta.sourceElement,
    originalIndex: meta.originalIndex,
    sourceId: meta.sourceId,
    outer: { points: outerPts },
    holes,
    boundingBox: box,
    area,
    centroid: centroid(outerPts),
    originalTransform: meta.originalTransform,
  }
}

function emptyDoc(warnings: ParserWarning[]): SvgGeometryDocument {
  return {
    parts: [],
    warnings,
    bounds: null,
    totalArea: 0,
    widthMm: null,
    heightMm: null,
    partCount: 0,
  }
}

/**
 * Parse SVG markup into millimeter GeometryPart[].
 * Operates on SVG text/DOM only — scripts/event handlers are never executed.
 */
export function parseSvgGeometry(
  raw: string,
  options: ParseGeometryOptions = {},
): SvgGeometryDocument {
  const warnings: ParserWarning[] = []
  const curveToleranceMm = options.curveToleranceMm ?? 0.25

  const doc = new DOMParser().parseFromString(raw, 'image/svg+xml')
  if (doc.querySelector('parsererror')) {
    return emptyDoc([
      {
        code: 'malformed_svg',
        message: 'SVG dosyası okunamadı. Geçerli bir SVG yükleyin.',
      },
    ])
  }

  const svg = [...doc.getElementsByTagName('*')].find(
    (el) => tagName(el) === 'svg',
  )
  if (!svg) {
    return emptyDoc([
      { code: 'malformed_svg', message: 'SVG kök elementi bulunamadı.' },
    ])
  }

  const scale = resolveUserToMm(
    svg.getAttribute('width'),
    svg.getAttribute('height'),
    svg.getAttribute('viewBox'),
    warnings,
  )

  const avgScale = (Math.abs(scale.sx) + Math.abs(scale.sy)) / 2 || 1
  const toleranceUser = curveToleranceMm / avgScale

  const parts: GeometryPart[] = []
  let index = 0

  type Frame = { el: Element; matrix: Matrix }
  const stack: Frame[] = [
    {
      el: svg,
      matrix: parseTransform(svg.getAttribute('transform'), warnings, 'svg'),
    },
  ]

  while (stack.length) {
    const frame = stack.pop()!
    const name = tagName(frame.el)

    if (SKIP_TAGS.has(name)) {
      if (name === 'defs') {
        warnings.push({
          code: 'skipped_defs',
          message: 'Skipped <defs> content',
          element: name,
        })
      }
      continue
    }

    if (SHAPE_TAGS.has(name)) {
      const local = parseTransform(
        frame.el.getAttribute('transform'),
        warnings,
        name,
      )
      const matrix = multiply(frame.matrix, local)
      const subpaths = elementToSubpaths(frame.el, toleranceUser, warnings)
      const transformed = subpaths.map((sp) => ({
        ...sp,
        points: applyMatrixToPoints(matrix, sp.points),
      }))
      const groups = classifySubpaths(transformed)
      if (groups.length === 0) {
        warnings.push({
          code: 'empty_geometry',
          message: `No usable geometry from <${name}>`,
          element: name,
        })
      }
      for (const g of groups) {
        const part = makePart(g.outer, g.holes, scale, {
          sourceElement: name,
          originalIndex: index,
          sourceId: frame.el.getAttribute('id'),
          originalTransform: frame.el.getAttribute('transform'),
        })
        if (part) {
          parts.push(part)
          index++
        }
      }
      continue
    }

    if (CONTAINER_TAGS.has(name)) {
      const children = [...frame.el.children].reverse()
      for (const child of children) {
        if (!(child instanceof Element)) continue
        const childName = tagName(child)
        if (SKIP_TAGS.has(childName)) {
          if (childName === 'defs') {
            warnings.push({
              code: 'skipped_defs',
              message: 'Skipped <defs> content',
              element: childName,
            })
          }
          continue
        }
        if (
          !SHAPE_TAGS.has(childName) &&
          !CONTAINER_TAGS.has(childName)
        ) {
          warnings.push({
            code: 'unsupported_element',
            message: `Unsupported element <${childName}>`,
            element: childName,
          })
          continue
        }
        const local = parseTransform(
          child.getAttribute('transform'),
          warnings,
          childName,
        )
        if (CONTAINER_TAGS.has(childName)) {
          stack.push({ el: child, matrix: multiply(frame.matrix, local) })
        } else {
          // Shape: keep parent matrix; shape branch applies its own transform.
          stack.push({ el: child, matrix: frame.matrix })
        }
      }
      continue
    }

    warnings.push({
      code: 'unsupported_element',
      message: `Unsupported element <${name}>`,
      element: name,
    })
  }

  const bounds = unionBounds(parts.map((p) => p.boundingBox))
  const totalArea = parts.reduce((s, p) => s + p.area, 0)

  return {
    parts,
    warnings,
    bounds,
    totalArea,
    widthMm: scale.widthMm,
    heightMm: scale.heightMm,
    partCount: parts.length,
  }
}
