import type { Bounds } from './types'

function overlaps(a: Bounds, b: Bounds): boolean {
  return !(
    a.maxX < b.minX ||
    b.maxX < a.minX ||
    a.maxY < b.minY ||
    b.maxY < a.minY
  )
}

/** Small uniform grid broad phase for immutable-after-insert sheet solids. */
export class UniformGridIndex {
  private readonly cells = new Map<string, Set<number>>()
  private readonly boundsById = new Map<number, Bounds>()
  private readonly originX: number
  private readonly originY: number
  private readonly cellSize: number

  constructor(sheet: Bounds, cellSize: number) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new RangeError('Collision index cell size must be positive and finite')
    }
    this.originX = sheet.minX
    this.originY = sheet.minY
    this.cellSize = cellSize
  }

  insert(id: number, bounds: Bounds): void {
    if (!Number.isSafeInteger(id) || id < 0) {
      throw new RangeError('Collision index IDs must be nonnegative safe integers')
    }
    const previous = this.boundsById.get(id)
    if (previous) this.remove(id, previous)
    this.boundsById.set(id, { ...bounds })
    for (const cell of this.cellsFor(bounds)) {
      const ids = this.cells.get(cell) ?? new Set<number>()
      ids.add(id)
      this.cells.set(cell, ids)
    }
  }

  query(bounds: Bounds): number[] {
    const ids = new Set<number>()
    for (const cell of this.cellsFor(bounds)) {
      for (const id of this.cells.get(cell) ?? []) {
        const indexed = this.boundsById.get(id)
        if (indexed && overlaps(indexed, bounds)) ids.add(id)
      }
    }
    return [...ids].sort((a, b) => a - b)
  }

  clone(): UniformGridIndex {
    const copy = new UniformGridIndex(
      {
        minX: this.originX,
        minY: this.originY,
        maxX: this.originX + this.cellSize,
        maxY: this.originY + this.cellSize,
      },
      this.cellSize,
    )
    for (const [id, bounds] of this.boundsById) copy.insert(id, bounds)
    return copy
  }

  private remove(id: number, bounds: Bounds): void {
    for (const cell of this.cellsFor(bounds)) {
      const ids = this.cells.get(cell)
      if (!ids) continue
      ids.delete(id)
      if (ids.size === 0) this.cells.delete(cell)
    }
  }

  private cellsFor(bounds: Bounds): string[] {
    const minX = Math.floor((bounds.minX - this.originX) / this.cellSize)
    const maxX = Math.floor((bounds.maxX - this.originX) / this.cellSize)
    const minY = Math.floor((bounds.minY - this.originY) / this.cellSize)
    const maxY = Math.floor((bounds.maxY - this.originY) / this.cellSize)
    const out: string[] = []
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) out.push(`${x}:${y}`)
    }
    return out
  }
}
