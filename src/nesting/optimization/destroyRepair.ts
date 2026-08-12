import { geomEps } from '../../geometry'
import { createVariant, type PreparedPart } from '../core/prepare'
import { isBetterScore } from '../scoring/fitness'
import type { NestingSuccess } from '../types'
import { cloneIndividual, type Individual } from './individual'
import type { EvaluateFn } from './localSearch'
import type { Rng } from './rng'

export type RepairOperator = 'random' | 'bounds' | 'sheet' | 'unplaced'
export type RepairState = { weights: Record<RepairOperator, number> }

const operators: readonly RepairOperator[] = ['random', 'bounds', 'sheet', 'unplaced']

export function createRepairState(): RepairState {
  return { weights: { random: 1, bounds: 1, sheet: 1, unplaced: 1 } }
}

export function rewardRepairOperator(state: RepairState, op: RepairOperator): void {
  state.weights[op]++
  if (operators.some((operator) => state.weights[operator] >= 16)) {
    for (const operator of operators) {
      state.weights[operator] = Math.max(1, Math.floor(state.weights[operator] / 2))
    }
  }
}

function chooseRepairOperator(state: RepairState, rng: Rng): RepairOperator {
  const total = operators.reduce(
    (sum, operator) => sum + Math.max(0, state.weights[operator]),
    0,
  )
  if (total <= 0) return 'random'
  let roll = rng.next() * total
  for (const operator of operators) {
    const weight = Math.max(0, state.weights[operator])
    if (weight > 0 && roll < weight) return operator
    roll -= weight
  }
  return 'unplaced'
}

function randomIndices(length: number, count: number, rng: Rng): number[] {
  return rng.shuffle(Array.from({ length }, (_, index) => index)).slice(0, count)
}

function boundedIndices(
  candidates: Iterable<number>,
  length: number,
  rng: Rng,
  minimum = 1,
): number[] {
  const limit = Math.min(length - 1, Math.max(minimum, Math.ceil(length * 0.2)))
  return rng.shuffle([...new Set(candidates)]).slice(0, limit)
}

function boundsIndices(
  start: Individual,
  result: NestingSuccess,
  preparedById: ReadonlyMap<string, PreparedPart>,
  rng: Rng,
): number[] {
  const sheets = new Map(result.sheets.map((sheet) => [sheet.sheetIndex, sheet]))
  const tolerance = Math.max(geomEps(), 1e-9)
  const candidates: number[] = []
  for (const placement of result.placements) {
    const bounds = sheets.get(placement.sheetIndex)?.usedBounds
    const prepared = preparedById.get(placement.partId)
    const index = start.order.indexOf(placement.partId)
    if (!bounds || !prepared || index < 0) continue
    const localBounds = createVariant(prepared, placement.rotation).solid.bounds
    const touchesRight = Math.abs(placement.x + localBounds.maxX - bounds.maxX) <= tolerance
    const touchesBottom = Math.abs(placement.y + localBounds.maxY - bounds.maxY) <= tolerance
    if (touchesRight || touchesBottom) candidates.push(index)
  }
  return boundedIndices(candidates, start.order.length, rng)
}

function sheetIndices(
  start: Individual,
  result: NestingSuccess,
  preparedById: ReadonlyMap<string, PreparedPart>,
  rng: Rng,
): number[] {
  const placementsBySheet = new Map<number, string[]>()
  for (const placement of result.placements) {
    const ids = placementsBySheet.get(placement.sheetIndex) ?? []
    ids.push(placement.partId)
    placementsBySheet.set(placement.sheetIndex, ids)
  }

  let target: { sheetIndex: number; ratio: number; ids: string[] } | undefined
  for (const sheet of result.sheets) {
    const ids = placementsBySheet.get(sheet.sheetIndex)
    const bounds = sheet.usedBounds
    if (!ids?.length || !bounds) continue
    const boundsArea = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY)
    const prepared = ids.map((id) => preparedById.get(id))
    if (!(boundsArea > 0) || prepared.some((part) => !part)) continue
    const ratio = prepared.reduce((area, part) => area + part!.area, 0) / boundsArea
    if (
      !target ||
      ratio < target.ratio ||
      (ratio === target.ratio && sheet.sheetIndex < target.sheetIndex)
    ) {
      target = { sheetIndex: sheet.sheetIndex, ratio, ids }
    }
  }

  return boundedIndices(
    target?.ids.map((id) => start.order.indexOf(id)).filter((index) => index >= 0) ?? [],
    start.order.length,
    rng,
  )
}

function unplacedIndices(start: Individual, result: NestingSuccess, rng: Rng): number[] {
  const candidates: number[] = []
  for (const id of result.unplacedPartIds) {
    const index = start.order.indexOf(id)
    if (index < 0) continue
    if (index > 0) candidates.push(index - 1)
    candidates.push(index)
  }
  return boundedIndices(candidates, start.order.length, rng, 2)
}

function repair(
  start: Individual,
  indices: number[],
  towardFront: boolean,
  rng: Rng,
): Individual {
  const individual = cloneIndividual(start)
  const removed = indices.map((index) => ({
    id: start.order[index]!,
    rotation: start.rotations[index]!,
  }))
  for (const index of indices.slice().sort((a, b) => b - a)) {
    individual.order.splice(index, 1)
    individual.rotations.splice(index, 1)
  }

  for (const [offset, entry] of rng.shuffle(removed).entries()) {
    const index = towardFront ? offset : rng.int(individual.order.length + 1)
    individual.order.splice(index, 0, entry.id)
    individual.rotations.splice(index, 0, entry.rotation)
  }
  return individual
}

export function proposeRepair(
  start: Individual,
  allowedRotations: readonly number[],
  result: NestingSuccess,
  preparedById: ReadonlyMap<string, PreparedPart>,
  rng: Rng,
  state: RepairState,
): { individual: Individual; operator: RepairOperator } {
  let operator = chooseRepairOperator(state, rng)
  if (start.order.length < 2) return { individual: cloneIndividual(start), operator }

  let indices: number[] = []
  if (operator === 'bounds') indices = boundsIndices(start, result, preparedById, rng)
  if (operator === 'sheet') indices = sheetIndices(start, result, preparedById, rng)
  if (operator === 'unplaced') indices = unplacedIndices(start, result, rng)
  if (operator === 'random' || indices.length === 0) {
    operator = 'random'
    const count = Math.min(
      start.order.length - 1,
      Math.max(1, Math.ceil(start.order.length * 0.1)),
    )
    indices = randomIndices(start.order.length, count, rng)
  }

  // Rerotation is deliberately optional; preserving rotations keeps ID/rotation pairs aligned.
  void allowedRotations
  return { individual: repair(start, indices, operator !== 'random', rng), operator }
}

/** Compatibility wrapper for the existing genetic optimizer. */
export function destroyRepairImprove(
  start: Individual,
  allowedRotations: number[],
  rng: Rng,
  evaluate: EvaluateFn,
  deadlineMs: number,
  now: () => number = () => performance.now(),
): Individual {
  let best = cloneIndividual(start)
  let bestScore = evaluate(best).score
  const n = best.order.length
  if (n < 3) return best

  const state = createRepairState()
  const emptyResult = {
    placements: [],
    sheets: [],
    unplacedPartIds: [],
  } as unknown as NestingSuccess
  const maxIter = Math.max(8, Math.min(40, n * 2))
  for (let iter = 0; iter < maxIter && now() < deadlineMs; iter++) {
    const proposal = proposeRepair(
      best,
      allowedRotations,
      emptyResult,
      new Map(),
      rng,
      state,
    )
    const score = evaluate(proposal.individual).score
    if (isBetterScore(score, bestScore)) {
      best = proposal.individual
      bestScore = score
      rewardRepairOperator(state, proposal.operator)
    }
  }
  return best
}
