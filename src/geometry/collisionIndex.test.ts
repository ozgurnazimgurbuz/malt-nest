import { describe, expect, it } from 'vitest'
import { UniformGridIndex } from './collisionIndex'

describe('UniformGridIndex', () => {
  it('returns only indexed bounds intersecting a query and clones independently', () => {
    const index = new UniformGridIndex(
      { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      10,
    )
    index.insert(1, { minX: 0, minY: 0, maxX: 9, maxY: 9 })
    index.insert(2, { minX: 50, minY: 50, maxX: 59, maxY: 59 })

    expect(index.query({ minX: 5, minY: 5, maxX: 12, maxY: 12 })).toEqual([1])

    const clone = index.clone()
    clone.insert(3, { minX: 5, minY: 5, maxX: 6, maxY: 6 })
    expect(index.query({ minX: 5, minY: 5, maxX: 6, maxY: 6 })).toEqual([1])
    expect(clone.query({ minX: 5, minY: 5, maxX: 6, maxY: 6 })).toEqual([1, 3])
  })
})
