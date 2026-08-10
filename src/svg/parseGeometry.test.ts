import { describe, expect, it } from 'vitest'
import { polygonArea } from '../geometry'
import { parseSvgGeometry } from './parseGeometry'

const TOL = 0.5

function svg(body: string, root = 'width="100mm" height="100mm" viewBox="0 0 100 100"') {
  return `<svg xmlns="http://www.w3.org/2000/svg" ${root}>${body}</svg>`
}

function expectClose(a: number, b: number, tol = TOL) {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)
}

describe('parseSvgGeometry', () => {
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

  it('6. line', () => {
    const doc = parseSvgGeometry(svg('<line x1="0" y1="0" x2="50" y2="0"/>'))
    expect(doc.partCount).toBe(1)
    const p = doc.parts[0]!
    expect(p.outer.points).toHaveLength(2)
    expectClose(p.boundingBox.width, 50)
    expectClose(p.area, 0)
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
    // Outer 40x40, inner hole 20x20 centered
    const doc = parseSvgGeometry(
      svg(
        '<path d="M0 0 H40 V40 H0 Z M10 10 H30 V30 H10 Z"/>',
      ),
    )
    expect(doc.partCount).toBe(1)
    const p = doc.parts[0]!
    expect(p.holes.length).toBe(1)
    expectClose(polygonArea(p.outer.points), 1600, 5)
    expectClose(polygonArea(p.holes[0]!.points), 400, 5)
    expectClose(p.area, 1200, 10)
  })

  it('20. malformed SVG', () => {
    const doc = parseSvgGeometry('<not-svg>broken')
    expect(doc.partCount).toBe(0)
    expect(doc.warnings.some((w) => w.code === 'malformed_svg')).toBe(true)
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
