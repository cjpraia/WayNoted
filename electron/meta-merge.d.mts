export function mergeMeta<T>(current: T, base: T, proposed: T, path?: string): T
export function pageContentChanged(before: unknown, after: unknown): boolean
export function assignSequences<T>(current: T | null, proposed: T): T
export function jsonEqual(a: unknown, b: unknown): boolean
