export type { GeometryBackend } from './clipper2'
export { createClipper2Backend, roundTripScaled } from './clipper2'

import { createClipper2Backend } from './clipper2'
import type { GeometryBackend } from './clipper2'

let active: GeometryBackend = createClipper2Backend()

export function getGeometryBackend(): GeometryBackend {
  return active
}

export function setGeometryBackend(backend: GeometryBackend): void {
  active = backend
}
