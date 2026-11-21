import {resolveKindId, ElementDomain} from './geometry_contract'
import {elementSourceOf} from './data_kinds'
import type {GeometryBase} from './object_workflows'
export interface DeformationProvider {
  kindId: string
  capture(data: object): GeometryBase
  write(data: object, handles: number[], positions: number[]): void
}
const providers = new Map<string, DeformationProvider>()
export function registerDeformationSource(provider: DeformationProvider): void {
  if (providers.has(provider.kindId))
    throw new Error(`Deformation source already registered: ${provider.kindId}`)
  providers.set(provider.kindId, provider)
}
export function unregisterDeformationSource(kind: string): void {
  providers.delete(kind)
}
export function deformationSource(
  data: object | undefined
):
  | {
      capture(): GeometryBase
      write(base: GeometryBase, positions: number[]): void
    }
  | undefined {
  if (!data) return undefined
  const provider = providers.get(resolveKindId(data) ?? '')
  const elements = elementSourceOf(data)
  if (!provider && !elements) return undefined
  const capture = () =>
    provider
      ? provider.capture(data)
      : {
          handles: Array.from(elements!.listElements(ElementDomain.VERT)),
          positions: [],
        }
  return {
    capture() {
      const base = capture()
      if (!provider)
        base.positions = Array.from(
          elements!.getPositions(
            ElementDomain.VERT,
            Int32Array.from(base.handles)
          )
        )
      if (base.handles.length > 100000)
        throw new Error(
          'Deformation authoring supports up to 100,000 vertices per object'
        )
      return base
    },
    write(base, positions) {
      if (
        positions.length !== base.handles.length * 3 ||
        positions.some((n) => !Number.isFinite(n))
      )
        throw new Error('Invalid deformation coordinates')
      const current = capture().handles
      if (
        current.length !== base.handles.length ||
        current.some((id, i) => id !== base.handles[i])
      )
        throw new Error(
          'Apply modifiers and unbind the rig before changing topology'
        )
      if (provider) provider.write(data, base.handles, positions)
      else
        elements!.setPositions(
          ElementDomain.VERT,
          Int32Array.from(base.handles),
          Float64Array.from(positions)
        )
    },
  }
}
