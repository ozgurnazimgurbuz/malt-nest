import { describe, expect, it } from 'vitest'
import {
  createConvergenceState,
  markRequiredOrdersComplete,
  recordChampion,
  recordEvaluation,
  recordFirstChampion,
  shouldStop,
} from './convergence'

describe('convergence policy', () => {
  it('sets a minimum evaluation limit of 64', () => {
    expect(
      createConvergenceState({
        partCount: 10,
        deterministic: true,
        startedAtMs: 0,
      }).evaluationLimit,
    ).toBe(64)
  })

  it('scales the evaluation limit with part count', () => {
    expect(
      createConvergenceState({
        partCount: 20,
        deterministic: true,
        startedAtMs: 0,
      }).evaluationLimit,
    ).toBe(80)
  })

  it('rejects invalid part counts', () => {
    for (const partCount of [-1, 1.5, Infinity]) {
      expect(() =>
        createConvergenceState({ partCount, deterministic: true, startedAtMs: 0 }),
      ).toThrow(RangeError)
    }
  })

  it('stops immediately when aborted', () => {
    const state = createConvergenceState({
      partCount: 10,
      deterministic: true,
      startedAtMs: 0,
    })

    expect(shouldStop(state, 0, true)).toBe(true)
  })

  it('ignores clocks in deterministic mode before required orders complete', () => {
    const state = createConvergenceState({
      partCount: 10,
      deterministic: true,
      startedAtMs: 0,
    })
    recordFirstChampion(state, 40)

    expect(shouldStop(state, 140, false)).toBe(false)
    expect(shouldStop(state, 5_000, false)).toBe(false)
  })

  it('stops deterministically only after required orders and the non-improvement limit', () => {
    const state = createConvergenceState({
      partCount: 10,
      deterministic: true,
      startedAtMs: 0,
    })
    for (let i = 0; i < state.evaluationLimit; i++) recordEvaluation(state)

    expect(shouldStop(state, 0, false)).toBe(false)

    markRequiredOrdersComplete(state)
    for (let i = 0; i < state.evaluationLimit - 1; i++) recordEvaluation(state)
    expect(shouldStop(state, 0, false)).toBe(false)

    recordEvaluation(state)
    expect(shouldStop(state, 0, false)).toBe(true)
  })

  it('stops non-deterministic stagnation at the 100ms floor boundary', () => {
    const state = createConvergenceState({
      partCount: 10,
      deterministic: false,
      startedAtMs: 0,
    })
    recordFirstChampion(state, 40)

    expect(shouldStop(state, 139, false)).toBe(false)
    expect(shouldStop(state, 140, false)).toBe(true)
  })

  it('uses twice the seed duration when it exceeds the floor', () => {
    const state = createConvergenceState({
      partCount: 10,
      deterministic: false,
      startedAtMs: 0,
    })
    recordFirstChampion(state, 80)

    expect(shouldStop(state, 239, false)).toBe(false)
    expect(shouldStop(state, 240, false)).toBe(true)
  })

  it('records improvements without replacing the seed timestamp or total evaluations', () => {
    const state = createConvergenceState({
      partCount: 10,
      deterministic: false,
      startedAtMs: 0,
    })
    recordFirstChampion(state, 40)
    recordFirstChampion(state, 50)
    recordEvaluation(state)
    recordEvaluation(state)
    recordChampion(state, 90)

    expect(state.firstChampionMs).toBe(40)
    expect(state.lastImprovementMs).toBe(90)
    expect(state.evaluations).toBe(2)
    expect(state.evaluationsSinceImprovement).toBe(0)
  })

  it('resets the count when mandatory orders complete', () => {
    const state = createConvergenceState({
      partCount: 10,
      deterministic: true,
      startedAtMs: 0,
    })
    recordEvaluation(state)

    markRequiredOrdersComplete(state)

    expect(state.requiredOrdersComplete).toBe(true)
    expect(state.evaluationsSinceImprovement).toBe(0)
  })

  it('applies the safety ceiling before mandatory orders complete', () => {
    const state = createConvergenceState({
      partCount: 10,
      deterministic: false,
      startedAtMs: 100,
    })

    expect(shouldStop(state, 5_099, false)).toBe(false)
    expect(shouldStop(state, 5_100, false)).toBe(true)
  })

  it('does not time-stop without a champion except at the safety ceiling', () => {
    const state = createConvergenceState({
      partCount: 10,
      deterministic: false,
      startedAtMs: 0,
    })

    expect(shouldStop(state, 4_999, false)).toBe(false)
    expect(shouldStop(state, 5_000, false)).toBe(true)
  })
})
