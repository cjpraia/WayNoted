// Tipos nativos: o conjunto principal nasce criado e visível em todo espaço (novo ou existente, uma única vez).
// Puro e testável. Casa por `preset` (nunca por nome), não duplica, não sobrescreve e não recria o que o usuário
// excluiu. docs/USAGE.md ("Tipos nativos desde o início").
import type { ObjectTypesPrefs } from '../types'
import type { ObjectType } from './model.ts'
import { fold } from './model.ts'
import { NATIVE_PRESETS, presetType, type PresetId } from './presets.ts'

type Locale = 'pt-BR' | 'en-US'

export function isNativePreset(preset: string | undefined): preset is PresetId {
  return !!preset && (NATIVE_PRESETS as readonly string[]).includes(preset)
}
/** Posição na ordem nativa (tipos sem preset nativo vão depois). */
export function nativeRank(type: ObjectType): number {
  const index = type.preset ? NATIVE_PRESETS.indexOf(type.preset as PresetId) : -1
  return index < 0 ? NATIVE_PRESETS.length : index
}

export interface NativeSeed { types: ObjectType[]; prefs: ObjectTypesPrefs; created: string[] }

/** Cria os nativos que faltam (por preset). `force` ignora a flag e a lista de excluídos ("Restaurar tipos nativos"). */
function fill(types: readonly ObjectType[], prefs: ObjectTypesPrefs, locale: Locale, now: number, newId: (() => string) | undefined, force: boolean): NativeSeed {
  const dismissed = new Set(force ? [] : prefs.nativeTypesDismissed ?? [])
  const next = types.map((type) => isNativePreset(type.preset) && !type.adoptedAt ? { ...type, adoptedAt: now } : type) // legados ocultos passam a visíveis
  const created: string[] = []
  const names = new Set(next.map((type) => fold(type.name)))
  for (const id of NATIVE_PRESETS) {
    if (dismissed.has(id) || next.some((type) => type.preset === id)) continue
    const type = { ...presetType(id, locale, now, newId), adoptedAt: now }
    // Um tipo do usuário com o mesmo nome (sem esse preset) continua intacto; o nativo ganha um sufixo para as #tags não se confundirem.
    if (names.has(fold(type.name))) type.name = locale === 'en-US' ? `${type.name} (built-in)` : `${type.name} (nativo)`
    names.add(fold(type.name))
    next.push(type); created.push(type.id)
  }
  const restPrefs = { ...prefs, nativeTypesSeeded: true }
  if (force) delete restPrefs.nativeTypesDismissed
  return { types: next, prefs: restPrefs, created }
}

/** Migração única e idempotente: `null` quando já foi feita. */
export function seedNativeTypes(types: readonly ObjectType[] | undefined, prefs: ObjectTypesPrefs | undefined, locale: Locale, now = Date.now(), newId?: () => string): NativeSeed | null {
  if (prefs?.nativeTypesSeeded) return null
  return fill(types ?? [], prefs ?? {}, locale, now, newId, false)
}

/** "Restaurar tipos nativos": recria os excluídos (sem tocar nos existentes). */
export function restoreNativeTypes(types: readonly ObjectType[], prefs: ObjectTypesPrefs, locale: Locale, now = Date.now(), newId?: () => string): NativeSeed {
  return fill(types, prefs, locale, now, newId, true)
}

/** Presets nativos hoje ausentes (excluídos): quantos "Restaurar tipos nativos" recriaria. */
export function missingNativePresets(types: readonly ObjectType[]): PresetId[] {
  return NATIVE_PRESETS.filter((id) => !types.some((type) => type.preset === id))
}
