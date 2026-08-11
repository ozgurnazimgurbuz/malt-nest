import { describe, expect, it } from 'vitest'
import {
  parseSvg,
  pathToRings,
  shapeArea,
  shapeBounds,
  validateShape,
} from '../src/geometry'

const svg = (body: string, transform = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg"${transform}>${body}</svg>`

function expectBounds(
  markup: string,
  expected: { minX: number; minY: number; maxX: number; maxY: number },
) {
  const bounds = shapeBounds(parseSvg(markup).shapes[0]!)!
  expect(bounds.minX).toBeCloseTo(expected.minX, 9)
  expect(bounds.minY).toBeCloseTo(expected.minY, 9)
  expect(bounds.maxX).toBeCloseTo(expected.maxX, 9)
  expect(bounds.maxY).toBeCloseTo(expected.maxY, 9)
}

describe('SVG compound paths', () => {
  it('keeps disjoint subpaths as separate polygons', () => {
    const result = parseSvg(
      svg('<path d="M0 0H10V10H0Z M20 0H25V5H20Z"/>'),
    )

    expect(result.shapes).toHaveLength(1)
    expect(result.shapes[0]!.polygons).toHaveLength(2)
    expect(result.meta).toMatchObject({ ringCount: 2, holeCount: 0 })
    expect(shapeArea(result.shapes[0]!)).toBeCloseTo(125, 9)
  })

  it('classifies contained subpaths as holes and nested islands as polygons', () => {
    const result = parseSvg(
      svg(
        '<path fill-rule="evenodd" d="M0 0H20V20H0Z M5 5H15V15H5Z M9 9H11V11H9Z"/>',
      ),
    )

    expect(result.shapes[0]!.polygons).toHaveLength(2)
    expect(result.meta).toMatchObject({ ringCount: 3, holeCount: 1 })
    expect(shapeArea(result.shapes[0]!)).toBeCloseTo(304, 9)
    expect(validateShape(result.shapes[0]!).ok).toBe(true)
  })

  it('respects nonzero winding and inherited evenodd fill rules', () => {
    const same = 'M0 0H20V20H0Z M5 5H15V15H5Z'
    const opposite = 'M0 0H20V20H0Z M5 5V15H15V5Z'

    const solid = parseSvg(svg(`<path d="${same}"/>`)).shapes[0]!
    expect(solid.polygons).toHaveLength(1)
    expect(solid.polygons[0]!.holes).toHaveLength(0)
    expect(shapeArea(solid)).toBeCloseTo(400, 9)

    const hole = parseSvg(svg(`<path d="${opposite}"/>`)).shapes[0]!
    expect(hole.polygons[0]!.holes).toHaveLength(1)
    expect(shapeArea(hole)).toBeCloseTo(300, 9)

    const inherited = parseSvg(
      svg(`<g fill-rule="evenodd"><path d="${same}"/></g>`),
    ).shapes[0]!
    expect(inherited.polygons[0]!.holes).toHaveLength(1)
    expect(shapeArea(inherited)).toBeCloseTo(300, 9)
  })
})

describe('SVG transforms', () => {
  it('inherits nested group transforms', () => {
    expectBounds(
      svg(
        '<g transform="translate(10 5)"><g transform="scale(2 3)"><rect width="2" height="1"/></g></g>',
      ),
      { minX: 10, minY: 5, maxX: 14, maxY: 8 },
    )
  })

  it('composes SVG transform lists in order', () => {
    expectBounds(
      svg('<rect width="2" height="1" transform="translate(10 5) scale(2 3)"/>'),
      { minX: 10, minY: 5, maxX: 14, maxY: 8 },
    )
  })

  it.each([
    [
      'matrix',
      'matrix(2 0 0 3 5 7)',
      { minX: 5, minY: 7, maxX: 9, maxY: 10 },
    ],
    [
      'translate',
      'translate(5 7)',
      { minX: 5, minY: 7, maxX: 7, maxY: 8 },
    ],
    ['scale', 'scale(2 3)', { minX: 0, minY: 0, maxX: 4, maxY: 3 }],
    ['rotate', 'rotate(90)', { minX: -1, minY: 0, maxX: 0, maxY: 2 }],
    [
      'rotate about a point',
      'rotate(90 1 1)',
      { minX: 1, minY: 0, maxX: 2, maxY: 2 },
    ],
    ['skewX', 'skewX(45)', { minX: 0, minY: 0, maxX: 3, maxY: 1 }],
    ['skewY', 'skewY(45)', { minX: 0, minY: 0, maxX: 2, maxY: 3 }],
  ])('applies %s', (_name, transform, expected) => {
    expectBounds(
      svg(`<rect width="2" height="1" transform="${transform}"/>`),
      expected,
    )
  })

  it('applies a transform inherited from the SVG root', () => {
    expectBounds(svg('<rect width="2" height="1"/>', ' transform="scale(3)"'), {
      minX: 0,
      minY: 0,
      maxX: 6,
      maxY: 3,
    })
  })
})

describe('SVG input handling', () => {
  it('reports curves only when parsed geometry contains curves', () => {
    expect(
      parseSvg(
        svg('<rect width="2" height="1"/><path d="M0 0H1V1H0Z"/>'),
      ).meta.hasCurves,
    ).toBe(false)
    expect(
      parseSvg(svg('<path d="M0 0 C0 1 1 1 1 0 L0 0Z"/>')).meta
        .hasCurves,
    ).toBe(true)
    expect(parseSvg(svg('<circle cx="5" cy="5" r="2"/>')).meta.hasCurves).toBe(
      true,
    )
  })

  it('increases curve density when a transform magnifies flattening error', () => {
    const path = '<path d="M0 0 C0 1 1 1 1 0 L0 0Z"/>'
    const unscaled = parseSvg(svg(path)).shapes[0]!.polygons[0]!.outer.length
    const scaled = parseSvg(svg(`<g transform="scale(100)">${path}</g>`))
      .shapes[0]!.polygons[0]!.outer.length

    expect(scaled).toBeGreaterThan(unscaled)
  })

  it('rejects malformed path data', () => {
    expect(() =>
      parseSvg(svg('<path d="M0 0 X10 10 Z"/>')),
    ).toThrowError(/path/i)
    expect(() => parseSvg(svg('<path d="M0 0 L10"/>'))).toThrowError(/path/i)
    expect(() =>
      parseSvg(svg('<path d="M0 0 A5 5 0 2 0 10 10 Z"/>')),
    ).toThrowError(/path|arc/i)
    expect(() =>
      parseSvg(svg('<path d="L10 0 L10 10 L0 10 Z"/>')),
    ).toThrowError(/path|move/i)
  })

  it('continues drawing from the subpath start after close-path', () => {
    const rings = pathToRings('M0 0 L10 0 L0 10 Z L10 0 L10 10 Z')

    expect(rings).toHaveLength(2)
    expect(rings[1]).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ])
  })

  it('rejects malformed XML instead of returning partial geometry', () => {
    expect(() => parseSvg('<svg><rect width="2" height="1"></svg>')).toThrowError(
      /SVG/i,
    )
  })

  it('rejects malformed numeric attributes instead of substituting defaults', () => {
    expect(() =>
      parseSvg(svg('<rect x="not-a-number" width="2" height="1"/>')),
    ).toThrowError(/attribute|number/i)
  })

  it('rejects invalid and odd-length polygon point lists', () => {
    expect(() =>
      parseSvg(svg('<polygon points="0,0 2,nope 2,2"/>')),
    ).toThrowError(/points|number/i)
    expect(() =>
      parseSvg(svg('<polygon points="0,0 2,0 2"/>')),
    ).toThrowError(/points/i)
    expect(() =>
      parseSvg(svg('<polygon points="0,0 1e999,0 0,1"/>')),
    ).toThrowError(/points|number/i)
    expect(() =>
      parseSvg(svg('<polyline points="0,0 1e999,0 0,1"/>')),
    ).toThrowError(/points|number/i)
  })

  it('does not emit geometry from definition-only containers', () => {
    const result = parseSvg(
      svg(`
        <defs><rect width="100" height="100"/></defs>
        <clipPath><rect width="90" height="90"/></clipPath>
        <mask><rect width="80" height="80"/></mask>
        <symbol><rect width="70" height="70"/></symbol>
        <rect width="2" height="1"/>
      `),
    )

    expect(result.shapes).toHaveLength(1)
    expect(shapeArea(result.shapes[0]!)).toBe(2)
  })

  it('walks deeply nested groups without overflowing the call stack', () => {
    const depth = 5_000
    const markup = svg(
      `${'<g>'.repeat(depth)}<rect width="2" height="1"/>${'</g>'.repeat(depth)}`,
    )

    const result = parseSvg(markup)

    expect(result.shapes).toHaveLength(1)
    expect(shapeArea(result.shapes[0]!)).toBe(2)
  })
})
