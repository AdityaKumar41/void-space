/** Modeling modes are capabilities of the active data, not a list of installed addons. */
export interface ModelingModeDefinition {
  name: string
  uiname: string
  dataKinds?: readonly string[]
  hideFromModeMenu?: boolean
}

export function modelingModesForData<T extends ModelingModeDefinition>(modes: readonly T[], dataKind?: string): T[] {
  const order: Record<string, number> = {object: 0, boxmodel: 1, leafmesh: 1, sculptcore: 2}
  return modes
    .filter((mode) => !mode.hideFromModeMenu && (!mode.dataKinds || (!!dataKind && mode.dataKinds.includes(dataKind))))
    .sort((a, b) => (order[a.name] ?? 3) - (order[b.name] ?? 3) || a.uiname.localeCompare(b.uiname))
}

export function objectDataKind(data: unknown): string | undefined {
  if (!data) return undefined
  const value = data as {lib_type?: string; constructor: {dataDefine?: () => {dataKind?: string}}}
  return value.constructor.dataDefine?.().dataKind ?? value.lib_type
}
