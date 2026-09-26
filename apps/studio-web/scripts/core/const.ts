// Deliberately import-free: app_storage / identity_migration / addon storage all
// need APP_KEY_NAME, and a dependency here would drag the pathux bundle in with it.

// 8: selection masks persist as names, not ints (scripts/core/select_types.ts)
// 9: struct ids are derived from struct names, not registration order
export const APP_VERSION = 9

/**
 * First APP_VERSION whose embedded struct schema uses name-derived (stable)
 * struct ids. Files below it carry registration-order ids, so bytes preserved
 * out of one cannot be spliced into a file written by this build — see
 * `MissingDataBlock._legacyStructIds`.
 */
export const STABLE_STRUCT_ID_VERSION = 9

/**
 * APP_VERSIONs a build predating them cannot read *at all*, newest last.
 *
 * Most bumps do not belong here: a `.wproj` carries its own struct schema, so an
 * older build decodes a newer file's blocks and preserves whatever it has no
 * class for. Add a version only when that stops being true — the header layout
 * changes, or a block type stops being self-describing. `loadFile_start` uses
 * the list to tell "newer, but readable" apart from "newer, and not", so a
 * genuinely one-way break reports itself instead of surfacing as corruption.
 */
export const BREAKING_FILE_VERSIONS: readonly number[] = []

/** True when `version` is newer than this build *and* crosses a break in
 *  `breaking`. The list is injectable so the classification is testable without
 *  a real one-way break to point at. */
export function isBreakingFileVersion(
  version: number,
  breaking: readonly number[] = BREAKING_FILE_VERSIONS,
  reads: number = APP_VERSION
): boolean {
  return version > reads && breaking.some((v) => v > reads && v <= version)
}

/** Namespace for every persistent per-app key (localStorage, IndexedDB).
 *
 *  Renamed `faber-leaf` -> `void-studio` for the VOID·STUDIO fork. Renaming it strands
 *  existing profiles, which is why `core/identity_migration.ts` carries them forward — it
 *  now migrates from *both* this key's previous owners, newest first. Extend that file
 *  whenever this changes again, or a Creator loses their autosaved work on upgrade.
 *
 *  This is deliberately the only value here that is a *brand* rename. `FILE_EXT` and
 *  `FILE_MAGIC` below are format identity and are left alone: see the note on them. */
export const APP_KEY_NAME = 'void-studio'

/** Human-facing product name, for window titles, the about panel and addon headers.
 *
 *  Kept next to `APP_KEY_NAME` so the two cannot drift: the storage namespace is the
 *  machine spelling of the same product. */
export const PRODUCT_NAME = 'VOID·STUDIO'

/** The product this one publishes into, named once so UI copy has a single source. */
export const PARENT_PRODUCT_NAME = 'VOID·SPACE'

// File-format identity, deliberately NOT renamed: these appear inside every
// saved .wproj, so changing them would orphan users' files.
export const FILE_EXT = 'wproj'
export const FILE_MAGIC = 'WPRJ'

/* XXX doesn't work with typescript. */
export const EDGE_LINKED_LISTS = false as const

export const CompressionFlags = {
  JSZIP: 1,
}
