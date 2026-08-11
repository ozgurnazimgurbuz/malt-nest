import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  makeShape,
  normalizeShape,
  rotateShape,
  shapeArea,
  shapeBounds,
  shapeCentroid,
  isCcw,
} from '../src/geometry'

/** Golden snapshots — update intentionally if geometry model changes. */
const GOLDEN = {
  rect10x5: {
    area: 50,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    centroid: { x: 5, y: 2.5 },
    ccw: true,
  },
  L: {
    area: 5,
  },
  rotated90rect: {
    // rect 4x2 at origin → after 90° CCW: width 2 height 4
    width: 2,
    height: 4,
    area: 8,
  },
} as const

describe('golden geometry', () => {
  it('rectangle goldens', () => {
    const s = normalizeShape(
      makeShape('r', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 },
        { x: 0, y: 5 },
      ]),
    )
    expect(shapeArea(s)).toBe(GOLDEN.rect10x5.area)
    expect(shapeBounds(s)).toEqual(GOLDEN.rect10x5.bounds)
    expect(shapeCentroid(s)).toEqual(GOLDEN.rect10x5.centroid)
    expect(isCcw(s.polygons[0]!.outer)).toBe(GOLDEN.rect10x5.ccw)
  })

  it('L area golden', () => {
    const s = normalizeShape(
      makeShape('L', [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 3 },
        { x: 0, y: 3 },
      ]),
    )
    expect(shapeArea(s)).toBe(GOLDEN.L.area)
  })

  it('rotated rect golden', () => {
    const s = rotateShape(
      normalizeShape(
        makeShape('r', [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 2 },
          { x: 0, y: 2 },
        ]),
      ),
      90,
    )
    const b = shapeBounds(s)!
    expect(b.maxX - b.minX).toBeCloseTo(GOLDEN.rotated90rect.width, 9)
    expect(b.maxY - b.minY).toBeCloseTo(GOLDEN.rotated90rect.height, 9)
    expect(shapeArea(s)).toBeCloseTo(GOLDEN.rotated90rect.area, 9)
  })
})

describe('SVG goldens / fixtures', () => {
  it('24–28 fixture SVGs', () => {
    const cases = [
      {
        name: 'rect',
        svg: `<svg xmlns="http://www.w3.org/2000/svg"><rect x="1" y="2" width="10" height="5"/></svg>`,
        area: 50,
      },
      {
        name: 'polygon',
        svg: `<svg xmlns="http://www.w3.org/2000/svg"><polygon points="0,0 4,0 0,3"/></svg>`,
        area: 6,
      },
      {
        name: 'path',
        svg: `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L8 0 L8 4 L0 4 Z"/></svg>`,
        area: 32,
      },
      {
        name: 'curve',
        svg: `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 C 0 0, 10 0, 10 0 L10 5 L0 5 Z"/></svg>`,
        area: 50,
      },
      {
        name: 'hole',
        svg: `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 H20 V20 H0 Z M5 5 H15 V15 H5 Z"/></svg>`,
        area: 400 - 100,
      },
    ]

    return import('../src/geometry').then(({ parseSvg }) => {
      for (const c of cases) {
        const { shapes } = parseSvg(c.svg)
        expect(shapes.length, c.name).toBeGreaterThanOrEqual(1)
        expect(shapeArea(shapes[0]!), c.name).toBeCloseTo(c.area, 5)
      }
    })
  })
})

describe('Demo.svg extraction (no nest bench)', () => {
  it('reports shape count / holes / parse time', () => {
    const demo = '/Users/ozgurnazimgurbuz/Desktop/Demo.svg'
    let raw: string
    try {
      raw = readFileSync(demo, 'utf8')
    } catch {
      // Skip if Demo.svg not present on this machine
      expect(true).toBe(true)
      return
    }
    return import('../src/geometry').then(({ parseSvg, shapeArea }) => {
      const result = parseSvg(raw)
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          {
            shapeCount: result.meta.shapeCount,
            ringCount: result.meta.ringCount,
            holeCount: result.meta.holeCount,
            hasCurves: result.meta.hasCurves,
            parseMs: Number(result.meta.parseMs.toFixed(2)),
            totalArea: result.shapes.reduce((s, sh) => s + shapeArea(sh), 0),
          },
          null,
          2,
        ),
      )
      expect(result.meta.shapeCount).toBeGreaterThan(0)
    })
  })
})
