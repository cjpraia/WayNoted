import type { LocalNotification, Page } from '../src/types'
export function advanceSchedule(timestamp: number, repeat: string, now?: number): number
export function collectDueReminders(notifications: Record<string, LocalNotification>, pages: Record<string, Page>, now: number, uuid: () => string): { notifications: Record<string, LocalNotification>; due: LocalNotification[] }
