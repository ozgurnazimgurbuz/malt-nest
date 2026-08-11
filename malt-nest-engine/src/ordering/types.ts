/** Deterministic part ordering strategies (no search / optimizer). */
export type OrderingStrategy =
  | 'area_desc'
  | 'bbox_area_desc'
  | 'height_desc'
  | 'width_desc'
  | 'complexity_desc'

export const DEFAULT_ORDERING: OrderingStrategy = 'area_desc'

/** Base strategies used by multi-start FAST sweep (ETAP 6A). */
export const BASE_ORDERING_STRATEGIES: readonly OrderingStrategy[] = [
  'area_desc',
  'bbox_area_desc',
  'height_desc',
  'width_desc',
  'complexity_desc',
] as const
