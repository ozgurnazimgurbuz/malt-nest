import { describe, expect, it } from 'vitest'
import { solidsOverlap } from '../../geometry'
import { parseSvgGeometry } from '../../svg'
import { partRotationOrigin, rotatePoints, solidFromRings } from '../../geometry'
import { runBottomLeftNest } from './blf'
import type { NestingSettings, Placement } from '../types'
import type { GeometryPart } from '../../geometry'

const settings: NestingSettings = {
  spacingMm: 3,
  allowedRotations: [0, 90, 180, 270],
  rotationStepDeg: null,
  allowArbitraryRotation: false,
  optimizationLevel: 'fast',
  timeLimitMs: 5000,
}

function worldSolid(part: GeometryPart, pl: Placement) {
  const origin = partRotationOrigin(part.outer.points)
  const outer = rotatePoints(part.outer.points, pl.rotation, origin).map((p) => ({
    x: p.x + pl.x,
    y: p.y + pl.y,
  }))
  const holes = part.holes.map((h) =>
    rotatePoints(h.points, pl.rotation, origin).map((p) => ({
      x: p.x + pl.x,
      y: p.y + pl.y,
    })),
  )
  return solidFromRings(outer, holes)
}

describe('SVG → nest integration', () => {
  it('nests irregular paths, hole, and rectangles without overlap', () => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="400mm" height="300mm" viewBox="0 0 400 300">
        <rect x="0" y="0" width="40" height="25"/>
        <rect x="0" y="0" width="30" height="30"/>
        <path d="M0 0 H50 V20 H20 V50 H0 Z"/>
        <path d="M0 0 H60 V60 H0 Z M15 15 H45 V45 H15 Z"/>
        <polygon points="0,0 35,0 35,15 15,15 15,35 0,35"/>
      </svg>`
    const doc = parseSvgGeometry(svg)
    expect(doc.partCount).toBeGreaterThanOrEqual(5)
    const holePart = doc.parts.find((p) => p.holes.length > 0)
    expect(holePart).toBeTruthy()

    const result = runBottomLeftNest({
      parts: doc.parts,
      sheets: [{ widthMm: 200, heightMm: 150, marginMm: 5, quantity: 5 }],
      settings,
    })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.statistics.placedCount).toBe(doc.partCount)
    expect(result.unplacedPartIds).toHaveLength(0)

    const placed = result.placements.map((pl) => {
      const part = doc.parts.find((p) => p.id === pl.partId)!
      return worldSolid(part, pl)
    })
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(solidsOverlap(placed[i]!, placed[j]!)).toBe(false)
      }
    }
  })
})
