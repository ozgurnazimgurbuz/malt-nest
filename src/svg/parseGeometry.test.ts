import { describe, expect, it } from 'vitest'
import { polygonArea } from '../geometry'
import { validateGeometryPart } from '../nesting/core/validate'
import { parseSvgGeometry } from './parseGeometry'

const TOL = 0.5

function svg(body: string, root = 'width="100mm" height="100mm" viewBox="0 0 100 100"') {
  return `<svg xmlns="http://www.w3.org/2000/svg" ${root}>${body}</svg>`
}

function expectClose(a: number, b: number, tol = TOL) {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)
}

describe('parseSvgGeometry', () => {
  it('keeps Illustrator cubic outlines simple after flattening', () => {
    const doc = parseSvgGeometry(
      svg('<path d="M3969.5,5874.8l-608.4-635.1,554.6-4.2c87.1-.7,150.5-77.7,167-159.7,21.2-105.6-52.2-224.9-168.6-225.4l-867.9-4.2.5-220.8,880.4,3.3c99,.4,187.2,50,254.4,118,97.5,98.7,137.3,234.6,110.1,374.2-38.2,196.2-209.9,337.4-422.4,332.5l394.8,419.3-294.6,2.1Z"/>', 'viewBox="0 0 9765.3 7403.3"'),
    )

    expect(doc.partCount).toBe(1)
    expect(() => validateGeometryPart(doc.parts[0]!)).not.toThrow()
  })

  it('1. rect', () => {
    const doc = parseSvgGeometry(svg('<rect x="10" y="20" width="30" height="40"/>'))
    expect(doc.partCount).toBe(1)
    const p = doc.parts[0]!
    expectClose(p.boundingBox.minX, 10)
    expectClose(p.boundingBox.minY, 20)
    expectClose(p.boundingBox.width, 30)
    expectClose(p.boundingBox.height, 40)
    expectClose(p.area, 1200)
    expect(p.holes).toHaveLength(0)
    expect(p.outer.points.length).toBeGreaterThanOrEqual(4)
  })

  it('parses rounded-rectangle radii, defaults, and clamps', () => {
    const rounded = parseSvgGeometry(
      svg('<rect x="10" y="20" width="40" height="20" rx="5"/>'),
      { curveToleranceMm: 0.05 },
    ).parts[0]!
    expect(rounded.outer.points.length).toBeGreaterThan(4)
    expectClose(rounded.area, 800 - (4 - Math.PI) * 25, 1)

    const clamped = parseSvgGeometry(
      svg('<rect width="10" height="4" rx="100" ry="100"/>'),
      { curveToleranceMm: 0.05 },
    ).parts[0]!
    expectClose(clamped.area, Math.PI * 5 * 2, 0.5)

    const invalid = parseSvgGeometry(svg('<rect width="10" height="4" rx="-1"/>'))
    expect(invalid.partCount).toBe(0)
    expect(invalid.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'empty_geometry', element: 'rect' }),
      ]),
    )
  })

  it('2. circle', () => {
    const doc = parseSvgGeometry(svg('<circle cx="50" cy="50" r="20"/>'))
    expect(doc.partCount).toBe(1)
    const p = doc.parts[0]!
    expectClose(p.boundingBox.width, 40, 1)
    expectClose(p.boundingBox.height, 40, 1)
    expectClose(p.area, Math.PI * 400, 25)
    expect(p.holes).toHaveLength(0)
  })

  it('3. ellipse', () => {
    const doc = parseSvgGeometry(svg('<ellipse cx="40" cy="30" rx="20" ry="10"/>'))
    expect(doc.partCount).toBe(1)
    const p = doc.parts[0]!
    expectClose(p.boundingBox.width, 40, 1)
    expectClose(p.boundingBox.height, 20, 1)
    expectClose(p.area, Math.PI * 20 * 10, 20)
  })

  it('4. polygon', () => {
    const doc = parseSvgGeometry(
      svg('<polygon points="0,0 40,0 40,30 0,30"/>'),
    )
    expect(doc.partCount).toBe(1)
    expectClose(doc.parts[0]!.area, 1200)
    expectClose(doc.parts[0]!.boundingBox.width, 40)
    expectClose(doc.parts[0]!.boundingBox.height, 30)
  })

  it('5. polyline', () => {
    const doc = parseSvgGeometry(svg('<polyline points="0,0 10,0 10,10"/>'))
    expect(doc.partCount).toBe(1)
    const p = doc.parts[0]!
    expect(p.outer.points.length).toBeGreaterThanOrEqual(3)
    expectClose(p.boundingBox.width, 10)
    expectClose(p.boundingBox.height, 10)
  })

  it('6. ignores zero-area line geometry', () => {
    const doc = parseSvgGeometry(svg('<line x1="0" y1="0" x2="50" y2="0"/>'))
    expect(doc.partCount).toBe(0)
    expect(doc.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'empty_geometry', element: 'line' }),
      ]),
    )
  })

  it('7. simple path', () => {
    const doc = parseSvgGeometry(svg('<path d="M0 0 H20 V10 H0 Z"/>'))
    expect(doc.partCount).toBe(1)
    expectClose(doc.parts[0]!.area, 200)
    expect(doc.parts[0]!.holes).toHaveLength(0)
  })

  it('8. relative path commands', () => {
    const doc = parseSvgGeometry(svg('<path d="m10 10 l30 0 l0 20 l-30 0 z"/>'))
    expect(doc.partCount).toBe(1)
    expectClose(doc.parts[0]!.area, 600)
    expectClose(doc.parts[0]!.boundingBox.minX, 10)
    expectClose(doc.parts[0]!.boundingBox.minY, 10)
  })

  it('9. cubic Bézier', () => {
    const doc = parseSvgGeometry(
      svg('<path d="M0 0 C10 20 30 20 40 0 L40 20 L0 20 Z"/>'),
    )
    expect(doc.partCount).toBe(1)
    const p = doc.parts[0]!
    expect(p.outer.points.length).toBeGreaterThan(4)
    expect(p.area).toBeGreaterThan(100)
    expectClose(p.boundingBox.width, 40, 1)
  })

  it('10. quadratic Bézier', () => {
    const doc = parseSvgGeometry(
      svg('<path d="M0 20 Q20 0 40 20 L40 40 L0 40 Z"/>'),
    )
    expect(doc.partCount).toBe(1)
    expect(doc.parts[0]!.outer.points.length).toBeGreaterThan(4)
    expect(doc.parts[0]!.area).toBeGreaterThan(200)
  })

  it('11. smooth Bézier', () => {
    const doc = parseSvgGeometry(
      svg('<path d="M0 20 C10 0 20 0 30 20 S50 40 60 20 L60 50 L0 50 Z"/>'),
    )
    expect(doc.partCount).toBe(1)
    expect(doc.parts[0]!.outer.points.length).toBeGreaterThan(6)
    expectClose(doc.parts[0]!.boundingBox.width, 60, 2)
  })

  it('12. arc (small and large)', () => {
    const small = parseSvgGeometry(
      svg('<path d="M20 50 A20 20 0 0 1 60 50 L60 70 L20 70 Z"/>'),
    )
    expect(small.partCount).toBe(1)
    expect(small.parts[0]!.outer.points.length).toBeGreaterThan(4)

    const large = parseSvgGeometry(
      svg('<path d="M20 50 A20 20 0 1 1 60 50 L60 80 L20 80 Z"/>'),
    )
    expect(large.partCount).toBe(1)
    expect(large.parts[0]!.area).toBeGreaterThan(small.parts[0]!.area)
  })

  it('13. transformed rectangle', () => {
    const doc = parseSvgGeometry(
      svg('<rect x="0" y="0" width="20" height="10" transform="translate(30 40) rotate(90)"/>'),
    )
    expect(doc.partCount).toBe(1)
    const b = doc.parts[0]!.boundingBox
    // rotate(90) around origin then... wait, transform is translate then rotate?
    // SVG: transform list applied left-to-right: translate(30,40) then rotate(90)
    // Point (20,0) -> translate -> (50,40) -> rotate 90 around 0: (-40, 50)
    // Actually rotate(90) is around origin of current user space after translate.
    expectClose(b.width, 10, 1)
    expectClose(b.height, 20, 1)
    expect(doc.parts[0]!.area).toBeGreaterThan(150)
  })

  it('14. nested groups', () => {
    const doc = parseSvgGeometry(
      svg(`
        <g transform="translate(10 5)">
          <g transform="scale(2)">
            <rect x="0" y="0" width="10" height="10"/>
          </g>
        </g>
      `),
    )
    expect(doc.partCount).toBe(1)
    const b = doc.parts[0]!.boundingBox
    expectClose(b.minX, 10)
    expectClose(b.minY, 5)
    expectClose(b.width, 20)
    expectClose(b.height, 20)
    expectClose(doc.parts[0]!.area, 400)
  })

  it('15. multiple objects', () => {
    const doc = parseSvgGeometry(
      svg(`
        <rect x="0" y="0" width="10" height="10"/>
        <circle cx="30" cy="30" r="5"/>
        <path d="M50 0 H60 V10 H50 Z"/>
      `),
    )
    expect(doc.partCount).toBe(3)
    expect(doc.totalArea).toBeGreaterThan(100 + 50 + 80)
  })

  it('maps viewBox with preserveAspectRatio instead of stretching geometry', () => {
    const root = 'width="200mm" height="100mm" viewBox="0 0 100 100"'
    const meet = parseSvgGeometry(svg('<rect width="100" height="100"/>', root))
    expectClose(meet.parts[0]!.boundingBox.minX, 50)
    expectClose(meet.parts[0]!.boundingBox.width, 100)
    expectClose(meet.parts[0]!.boundingBox.height, 100)

    const none = parseSvgGeometry(
      svg(
        '<rect width="100" height="100"/>',
        `${root} preserveAspectRatio="none"`,
      ),
    )
    expectClose(none.parts[0]!.boundingBox.minX, 0)
    expectClose(none.parts[0]!.boundingBox.width, 200)
    expectClose(none.parts[0]!.boundingBox.height, 100)

    const aligned = parseSvgGeometry(
      svg(
        '<rect width="100" height="100"/>',
        `${root} preserveAspectRatio="xMaxYMin meet"`,
      ),
    )
    expectClose(aligned.parts[0]!.boundingBox.minX, 100)

    const unsupportedSlice = parseSvgGeometry(
      svg(
        '<rect width="100" height="100"/>',
        `${root} preserveAspectRatio="xMidYMid slice"`,
      ),
    )
    expect(unsupportedSlice.partCount).toBe(0)
    expect(unsupportedSlice.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_dimensions' }),
      ]),
    )
  })

  it('rejects malformed or unsupported root dimensions', () => {
    for (const root of [
      'width="bad" height="100mm" viewBox="0 0 100 100"',
      'width="100mm" height="100mm" viewBox="0 0 nope 100"',
      'width="100%" height="100mm" viewBox="0 0 100 100"',
      'width="-10mm" height="100mm" viewBox="0 0 100 100"',
    ]) {
      const doc = parseSvgGeometry(svg('<rect width="10" height="10"/>', root))
      expect(doc.partCount).toBe(0)
      expect(doc.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'invalid_dimensions' }),
        ]),
      )
    }
  })

  it('explicitly rejects unsupported nested SVG viewports', () => {
    const doc = parseSvgGeometry(
      svg(
        '<svg x="10" y="20" width="20" height="20" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
      ),
    )

    expect(doc.partCount).toBe(0)
    expect(doc.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'unsupported_element', element: 'svg' }),
      ]),
    )
  })

  it('16. mm units', () => {
    const doc = parseSvgGeometry(
      `<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100mm" viewBox="0 0 200 100">
        <rect x="0" y="0" width="200" height="100"/>
      </svg>`,
    )
    expectClose(doc.widthMm!, 200)
    expectClose(doc.heightMm!, 100)
    expectClose(doc.parts[0]!.area, 20000)
  })

  it('17. cm units', () => {
    const doc = parseSvgGeometry(
      `<svg xmlns="http://www.w3.org/2000/svg" width="10cm" height="5cm" viewBox="0 0 100 50">
        <rect x="0" y="0" width="100" height="50"/>
      </svg>`,
    )
    expectClose(doc.widthMm!, 100)
    expectClose(doc.heightMm!, 50)
    expectClose(doc.parts[0]!.area, 5000)
  })

  it('18. viewBox offset mapping', () => {
    const doc = parseSvgGeometry(
      `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="10 20 100 50">
        <rect x="10" y="20" width="100" height="50"/>
      </svg>`,
    )
    expect(doc.partCount).toBe(1)
    expectClose(doc.parts[0]!.boundingBox.minX, 0)
    expectClose(doc.parts[0]!.boundingBox.minY, 0)
    expectClose(doc.parts[0]!.boundingBox.width, 100)
    expectClose(doc.parts[0]!.boundingBox.height, 50)
  })

  it('19. compound path with hole', () => {
    // evenodd alternates fill at each nested contour.
    const doc = parseSvgGeometry(
      svg(
        '<path fill-rule="evenodd" d="M0 0 H40 V40 H0 Z M10 10 H30 V30 H10 Z"/>',
      ),
    )
    expect(doc.partCount).toBe(1)
    const p = doc.parts[0]!
    expect(p.holes.length).toBe(1)
    expectClose(polygonArea(p.outer.points), 1600, 5)
    expectClose(polygonArea(p.holes[0]!.points), 400, 5)
    expectClose(p.area, 1200, 10)
  })

  it('respects nonzero winding and inherited evenodd fill rules', () => {
    const sameWinding = 'M0 0 H40 V40 H0 Z M10 10 H30 V30 H10 Z'
    const oppositeWinding = 'M0 0 H40 V40 H0 Z M10 10 V30 H30 V10 Z'

    const nonzeroSolid = parseSvgGeometry(
      svg(`<path d="${sameWinding}"/>`),
    )
    expect(nonzeroSolid.parts[0]!.holes).toHaveLength(0)
    expectClose(nonzeroSolid.parts[0]!.area, 1600, 5)

    const nonzeroHole = parseSvgGeometry(
      svg(`<path d="${oppositeWinding}"/>`),
    )
    expect(nonzeroHole.parts[0]!.holes).toHaveLength(1)
    expectClose(nonzeroHole.parts[0]!.area, 1200, 5)

    const inheritedEvenodd = parseSvgGeometry(
      svg(`<g fill-rule="evenodd"><path d="${sameWinding}"/></g>`),
    )
    expect(inheritedEvenodd.parts[0]!.holes).toHaveLength(1)
    expectClose(inheritedEvenodd.parts[0]!.area, 1200, 5)
  })

  it('does not classify a partially contained subpath from its centroid alone', () => {
    const doc = parseSvgGeometry(
      svg(
        '<path d="M0 0 H10 V10 H0 Z M-5 5 L5 4 L5 6 Z"/>',
      ),
    )

    expect(doc.partCount).toBe(2)
    expect(doc.totalArea).toBeGreaterThan(100)
  })

  it('classifies fully contained concave subpaths even when their centroid is outside', () => {
    const doc = parseSvgGeometry(
      svg(
        '<path fill-rule="evenodd" d="M0 0 H10 V10 H7 V3 H3 V10 H0 Z M1 1 H9 V9 H8 V2 H2 V9 H1 Z"/>',
      ),
    )

    expect(doc.partCount).toBe(1)
    expect(doc.parts[0]!.holes).toHaveLength(1)
  })

  it('tightens curve flattening under inherited magnifying transforms', () => {
    const path = '<path d="M0 0 C0 1 1 1 1 0 L0 0 Z"/>'
    const plain = parseSvgGeometry(svg(path), { curveToleranceMm: 0.1 })
    const scaled = parseSvgGeometry(
      svg(`<g transform="scale(100)">${path}</g>`),
      { curveToleranceMm: 0.1 },
    )

    expect(scaled.parts[0]!.outer.points.length).toBeGreaterThan(
      plain.parts[0]!.outer.points.length,
    )
  })

  it('applies skew transforms and rejects malformed transform lists', () => {
    const skewed = parseSvgGeometry(
      svg('<rect width="10" height="10" transform="skewX(45)"/>'),
    )
    expectClose(skewed.parts[0]!.boundingBox.width, 20, 5)

    for (const transform of [
      'translate(10) garbage',
      'scale(2,3,4)',
      'rotate(30,5)',
    ]) {
      const doc = parseSvgGeometry(
        svg(`<rect width="10" height="10" transform="${transform}"/>`),
      )
      expect(doc.partCount).toBe(0)
      expect(doc.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'unsupported_transform' }),
        ]),
      )
    }
  })

  it('20. malformed SVG', () => {
    const doc = parseSvgGeometry('<not-svg>broken')
    expect(doc.partCount).toBe(0)
    expect(doc.warnings.some((w) => w.code === 'malformed_svg')).toBe(true)
  })

  it('rejects malformed path data instead of nesting partial geometry', () => {
    for (const d of [
      'M0 0 X10 10 Z',
      'M0 0 L10',
      'M0 0 A5 5 0 2 0 10 10 Z',
    ]) {
      const doc = parseSvgGeometry(svg(`<path d="${d}"/>`))
      expect(doc.partCount).toBe(0)
      expect(doc.warnings.some((warning) => warning.code === 'malformed_path')).toBe(
        true,
      )
    }
  })

  it('rejects malformed numeric shape attributes and point lists', () => {
    const rect = parseSvgGeometry(
      svg('<rect x="not-a-number" width="10" height="10"/>'),
    )
    const polygon = parseSvgGeometry(
      svg('<polygon points="0,0 10,nope 10,10 0,10"/>'),
    )

    expect(rect.partCount).toBe(0)
    expect(polygon.partCount).toBe(0)
    expect([...rect.warnings, ...polygon.warnings]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'empty_geometry' }),
      ]),
    )
  })

  it('21. defs (style/paint) are silent — not nesting geometry', () => {
    const doc = parseSvgGeometry(
      svg(`
        <defs>
          <style>.st0{fill:#c2c1c1}</style>
          <linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient>
          <clipPath id="c"><rect width="10" height="10"/></clipPath>
        </defs>
        <rect class="st0" x="0" y="0" width="20" height="10"/>
      `),
    )
    expect(doc.partCount).toBe(1)
    expectClose(doc.parts[0]!.area, 200)
    expect(doc.warnings).toEqual([])
  })
})
