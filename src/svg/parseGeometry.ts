import type { BoundingBox, GeometryPart, Point } from '../geometry'
import {
  boundingBox,
  centroid,
  netArea,
  normalizeWinding,
  unionBounds,
} from '../geometry'
import { classifySubpaths, type SvgFillRule } from './contours'
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
    x: (p.x - ox) * scale.sx + scale.offsetXMm,
    y: (p.y - oy) * scale.sy + scale.offsetYMm,
  }))
}

function resolveFillRule(el: Element, inherited: SvgFillRule): SvgFillRule {
  const attribute = el.getAttribute('fill-rule')?.trim().toLowerCase()
  if (attribute === 'evenodd' || attribute === 'nonzero') return attribute
  const style = el.getAttribute('style') ?? ''
  const inline = /(?:^|;)\s*fill-rule\s*:\s*(evenodd|nonzero)\b/i.exec(style)
  return (inline?.[1]?.toLowerCase() as SvgFillRule | undefined) ?? inherited
}

/** Maximum physical stretch from element user space into millimeters. */
function physicalScale(matrix: Matrix, scale: UserToMm): number {
  const a = scale.sx * matrix.a
  const b = scale.sy * matrix.b
  const c = scale.sx * matrix.c
  const d = scale.sy * matrix.d
  const sum = a * a + b * b + c * c + d * d
  const determinant = a * d - b * c
  const discriminant = Math.max(0, sum * sum - 4 * determinant * determinant)
  return Math.sqrt((sum + Math.sqrt(discriminant)) / 2)
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
  const outerPts = normalizeWinding(toMmPoints(outerUser, scale), true)
  if (outerPts.length < 2) return null
  const holes = holesUser
    .map((h) => ({ points: normalizeWinding(toMmPoints(h, scale), false) }))
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
  if (!Number.isFinite(curveToleranceMm) || curveToleranceMm <= 0) {
    throw new RangeError('curveToleranceMm must be finite and positive')
  }

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
    svg.getAttribute('preserveAspectRatio'),
  )
  if (!scale.supported) return emptyDoc(warnings)

  const parts: GeometryPart[] = []
  let index = 0

  const rootMatrix = parseTransform(
    svg.getAttribute('transform'),
    warnings,
    'svg',
  )
  if (!rootMatrix) return emptyDoc(warnings)

  type Frame = { el: Element; matrix: Matrix; fillRule: SvgFillRule }
  const stack: Frame[] = [
    {
      el: svg,
      matrix: rootMatrix,
      fillRule: resolveFillRule(svg, 'nonzero'),
    },
  ]

  while (stack.length) {
    const frame = stack.pop()!
    const name = tagName(frame.el)

    // defs / style / gradients / clipPath / mask / … — not drawn geometry for nesting.
    // Preview still uses the raw SVG, so paint defs remain visible there.
    if (SKIP_TAGS.has(name)) continue

    if (name === 'svg' && frame.el !== svg) {
      warnings.push({
        code: 'unsupported_element',
        message: 'Nested <svg> viewports are not supported',
        element: 'svg',
      })
      continue
    }

    if (SHAPE_TAGS.has(name)) {
      const local = parseTransform(
        frame.el.getAttribute('transform'),
        warnings,
        name,
      )
      if (!local) continue
      const matrix = multiply(frame.matrix, local)
      const scaleMm = physicalScale(matrix, scale)
      const toleranceUser =
        scaleMm > 0 && Number.isFinite(scaleMm)
          ? curveToleranceMm / scaleMm
          : curveToleranceMm
      const subpaths = elementToSubpaths(frame.el, toleranceUser, warnings)
      const transformed = subpaths.map((sp) => ({
        ...sp,
        points: applyMatrixToPoints(matrix, sp.points),
      }))
      const groups = classifySubpaths(
        transformed,
        resolveFillRule(frame.el, frame.fillRule),
      )
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
        if (SKIP_TAGS.has(childName)) continue
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
        if (!local) continue
        if (CONTAINER_TAGS.has(childName)) {
          stack.push({
            el: child,
            matrix: multiply(frame.matrix, local),
            fillRule: resolveFillRule(child, frame.fillRule),
          })
        } else {
          // Shape: keep parent matrix; shape branch applies its own transform.
          stack.push({
            el: child,
            matrix: frame.matrix,
            fillRule: frame.fillRule,
          })
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
