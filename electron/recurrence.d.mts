import type { DatabaseSchema, DateValue, LocalNotification, Page, Property, PropValue } from '../src/types'
export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly'
export interface RecurrenceRule { freq: RecurrenceFreq; interval: number; weekdays?: number[]; monthly?: 'day' | 'weekday' | 'lastWeekday'; until?: string; count?: number; anchor: string }
export const RECURRENCE_FREQS: RecurrenceFreq[]
export const REMINDER_OFFSETS: number[]
export function validISODate(value: unknown): value is string
export function addDays(value: string, days: number): string
export function daysBetween(from: string, to: string): number
export function weekdayOf(value: string): number
export function weekdayOrdinal(value: string): number
export function isLastWeekdayOfMonth(value: string): boolean
export function recurrenceRule(value: DateValue | null | undefined): RecurrenceRule | null
export function isRecurring(value: DateValue | null | undefined): boolean
export function occurrenceStarts(value: DateValue, from: string, to: string, limit?: number): { start: string; ordinal: number }[]
export function nextOccurrenceAfter(value: DateValue, after: string): string | null
export function advanceDateValue(value: DateValue, today: string): DateValue | null
export function describeRecurrence(value: DateValue, locale?: string): string
export function wallTimeToEpoch(date: string, time: string, zone: string): number | null
export function reminderInstant(value: DateValue, occurrence: string, minutesBefore: number, fallbackZone: string): number | null
export function doneProperty(schema: DatabaseSchema, dateProperty: Property | undefined): Property | null
export function isDoneValue(property: Property | null, value: PropValue | undefined): boolean
export function reconcileDateReminders(notifications: Record<string, LocalNotification> | undefined, pages: Record<string, Page>, now: number, options?: { timeZone?: string; locale?: string }): { notifications: Record<string, LocalNotification>; changed: boolean }
