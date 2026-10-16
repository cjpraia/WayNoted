import type { Page } from '../src/types'
export function pageBlockReferences(blocks: unknown[]): Map<string, { blockId: string; owned: boolean; ownership: string }>
export function ownedPageBlockChanges(ownerId: string, before: unknown[], after: unknown[], pages: Record<string, Page>, at?: number): Record<string, Partial<Page>>
