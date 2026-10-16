// "Continuar de onde parou": escolhe UM destino (Hick) — a última página com o bloco do cursor, ou a mais recente.
import type { Page, OnboardingSettings } from '../types.ts'

export interface ResumeTarget { pageId: string; blockId?: string; at: number; title: string; icon: string | null | undefined; excerpt: string }
type PageLike = Pick<Page, 'id' | 'title' | 'icon' | 'trashed' | 'updatedAt' | 'text'> & { database?: unknown; canvas?: unknown; passwordLock?: unknown }

export function pickResume(resume: OnboardingSettings['resume'], recent: readonly string[], pages: Record<string, PageLike | undefined>, isHidden: (id: string) => boolean = () => false): ResumeTarget | null {
  const candidate = (id: string) => { const p = pages[id]; return p && !p.trashed && !isHidden(id) ? p : null }
  const saved = resume && candidate(resume.pageId)
  if (resume && saved) return build(saved, resume.blockId, resume.at)
  for (const id of recent) { const p = candidate(id); if (p) return build(p, undefined, p.updatedAt) }
  return null
}

function build(page: PageLike, blockId: string | undefined, at: number): ResumeTarget {
  const excerpt = page.database || page.canvas ? '' : (page.text || '').replace(/\s+/g, ' ').trim().slice(0, 140)
  return { pageId: page.id, ...(blockId ? { blockId } : {}), at, title: page.title, icon: page.icon, excerpt }
}

/** Debounce de gravação do ponto de retomada: só grava se a página/bloco mudou. */
export function nextResume(current: OnboardingSettings['resume'], pageId: string, blockId: string | undefined, now: number): OnboardingSettings['resume'] {
  if (current && current.pageId === pageId && current.blockId === blockId && now - current.at < 60_000) return current
  return { pageId, ...(blockId ? { blockId } : {}), at: now }
}
