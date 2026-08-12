import { describe, expect, it } from 'vitest'
import {
  individualKey,
  isValidIndividual,
  type Individual,
} from './individual'
import {
  insertionMutation,
  rotationMutation,
  swapMutation,
} from './mutation'
import { createRng } from './rng'

function individual(): Individual {
  return {
    order: ['a', 'b', 'c', 'd'],
    rotations: [0, 90, 180, 270],
  }
}

describe('optimization primitives', () => {
  it('validates aligned order and rotation genes', () => {
    expect(
      isValidIndividual(
        individual(),
        ['a', 'b', 'c', 'd'],
        [0, 90, 180, 270],
      ),
    ).toBe(true)
    expect(
      isValidIndividual(
        { order: ['a', 'a', 'b', 'c'], rotations: [0, 0, 0, 0] },
        ['a', 'b', 'c', 'd'],
        [0],
      ),
    ).toBe(false)
  })

  it('replays the same random sequence from the same seed', () => {
    const a = createRng(123)
    const b = createRng(123)
    expect(Array.from({ length: 20 }, () => a.next())).toEqual(
      Array.from({ length: 20 }, () => b.next()),
    )
    expect(createRng(1).next()).not.toBe(createRng(2).next())
  })

  it('keeps swap, insertion, and rotation mutations valid', () => {
    const source = individual()
    const allowed = [0, 90, 180, 270]
    const mutations = [
      swapMutation(source, createRng(1)),
      insertionMutation(source, createRng(2)),
      rotationMutation(source, createRng(3), allowed),
    ]
    for (const result of mutations) {
      expect(isValidIndividual(result, source.order, allowed)).toBe(true)
    }
  })

  it('keys equal genes equally without delimiter collisions', () => {
    const source = individual()
    expect(individualKey(source, 's')).toBe(individualKey({ ...source }, 's'))
    expect(individualKey(source, 's')).not.toBe(
      individualKey({ ...source, rotations: [0, 0, 0, 0] }, 's'),
    )
    expect(
      individualKey({ order: ['b', 'a', 'a,a'], rotations: [0, 0, 0] }, 's'),
    ).not.toBe(
      individualKey({ order: ['b', 'a,a', 'a'], rotations: [0, 0, 0] }, 's'),
    )
  })
})
