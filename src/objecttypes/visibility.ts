// Quais tipos aparecem e onde (barra lateral, gerenciador, galeria). Puro e testável. docs/USAGE.md
// Regra: um tipo pronto que ninguém escolheu e que não está em uso fica oculto (nada é apagado).
import type { Page } from '../types'
import { effectiveProperties, fold, typeIndex, type ObjectType, type TypeList } from './model.ts'
import { PRESETS, presetLabel, type PresetId } from './presets.ts'
import { nativeRank } from './native.ts'
import type { ObjectTypesPrefs } from '../types'

type Locale = 'pt-BR' | 'en-US'

/** Tipo pronto criado em lote (versões antigas) que ninguém usa nem escolheu: oculto por padrão. */
export function isUnusedStarter(type: ObjectType, count: number): boolean {
  return count === 0 && !!type.preset && !type.adoptedAt
}

/** Tipos ocultos no gerenciador ("Mostrar tipos não usados"). */
export function hiddenStarterTypes(pages: Record<string, Page>, types: TypeList): ObjectType[] {
  const index = typeIndex(pages, types)
  return types.filter((type) => isUnusedStarter(type, index.get(type.id)?.length ?? 0))
}

export interface SidebarType { type: ObjectType; count: number }

/**
 * Seção "Tipos" da barra lateral: os nativos sempre (mesmo com 0 páginas, sem contador) e os do usuário;
 * tipos prontos antigos que ninguém usa nem escolheu continuam ocultos ou escolhidos pelo usuário (criados por ele ou "Usar" da
 * galeria). Ordem: mais páginas primeiro; empate pela ordem nativa e depois pela página editada mais recentemente.
 */
export function sidebarTypes(pages: Record<string, Page>, types: TypeList): SidebarType[] {
  const index = typeIndex(pages, types)
  const recency = (type: ObjectType) => {
    let latest = type.adoptedAt ?? 0
    for (const id of index.get(type.id) ?? []) { const updated = pages[id]?.updatedAt ?? 0; if (updated > latest) latest = updated }
    return latest
  }
  return types
    .map((type) => ({ type, count: index.get(type.id)?.length ?? 0, at: 0 }))
    .filter(({ type, count }) => !isUnusedStarter(type, count))
    .map((entry) => ({ ...entry, at: recency(entry.type) }))
    .sort((a, b) => b.count - a.count || nativeRank(a.type) - nativeRank(b.type) || b.at - a.at)
    .map(({ type, count }) => ({ type, count }))
}

/** A seção da barra lateral em si: respeita "Ocultar da barra lateral" e a ordem manual (`prefs.sidebarOrder`). */
export function sidebarSectionTypes(pages: Record<string, Page>, types: TypeList, prefs?: ObjectTypesPrefs): SidebarType[] {
  const list = sidebarTypes(pages, types).filter(({ type }) => !type.sidebarHidden)
  const order = prefs?.sidebarOrder
  if (!order?.length) return list
  const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? order.length : i }
  return list.map((entry, position) => ({ entry, position })).sort((a, b) => rank(a.entry.type.id) - rank(b.entry.type.id) || a.position - b.position).map(({ entry }) => entry)
}

export interface GalleryEntry {
  preset: PresetId
  name: string
  icon: string
  color: string
  description: string
  /** Nomes dos campos, na ordem. */
  fields: string[]
  /** Tipo já existente no espaço (pelo preset ou pelo mesmo nome). */
  existing?: ObjectType
  /** Já escolhido/em uso: o botão vira "Abrir". */
  adopted: boolean
}

/** Cartões da galeria "Explorar tipos": só os presets ainda não criados neste espaço (Receita e os excluídos). */
export function galleryEntries(pages: Record<string, Page>, types: TypeList, locale: Locale): GalleryEntry[] {
  return allGalleryEntries(pages, types, locale).filter((entry) => !entry.adopted)
}

/** Todos os presets, com o estado de cada um neste espaço. */
export function allGalleryEntries(pages: Record<string, Page>, types: TypeList, locale: Locale): GalleryEntry[] {
  const index = typeIndex(pages, types)
  return PRESETS.map((spec) => {
    const label = presetLabel(spec.id, locale)
    const existing = types.find((type) => type.preset === spec.id) ?? types.find((type) => fold(type.name) === fold(label.name))
    const count = existing ? index.get(existing.id)?.length ?? 0 : 0
    return {
      preset: spec.id, name: label.name, icon: label.icon, color: spec.color, description: label.description,
      fields: existing ? effectiveProperties(types, existing.id).map((prop) => prop.name) : spec.fields.map((field) => (locale === 'en-US' ? field.name[1] : field.name[0])),
      existing, adopted: !!existing && !isUnusedStarter(existing, count),
    }
  })
}

/** "E-mail, Telefone, Empresa +2" (no máximo `max` nomes). */
export function fieldSummary(fields: string[], max = 3): string {
  const shown = fields.slice(0, max).join(', ')
  return fields.length > max ? `${shown} +${fields.length - max}` : shown
}
