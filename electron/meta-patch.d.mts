export interface MetaPatch { pages: Record<string, unknown>; settings?: unknown; notifications?: unknown; syncedBlocks?: unknown; size: number }
export function diffMeta<T>(prev: T | null, next: T): MetaPatch
export function applyMetaPatch<T>(base: T, patch: MetaPatch | null | undefined): T
export function validMetaPatch(patch: unknown): boolean
