/** Advances in local calendar time, retaining the day where possible across shorter months. */
export function advanceSchedule(timestamp, repeat, now = timestamp) {
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(repeat)) return timestamp
  const date = new Date(timestamp)
  const day = date.getDate()
  let limit = 0
  do {
    if (repeat === 'daily' || repeat === 'weekly') date.setDate(date.getDate() + (repeat === 'daily' ? 1 : 7))
    else {
      date.setDate(1)
      date.setMonth(date.getMonth() + (repeat === 'monthly' ? 1 : 12))
      const end = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
      date.setDate(Math.min(day, end))
    }
  } while (date.getTime() <= now && ++limit < 50000)
  return date.getTime()
}

export function collectDueReminders(notifications, pages, now, uuid) {
  const next = { ...notifications }, due = []
  for (const item of Object.values(notifications ?? {})) {
    if (item.firedAt !== null || item.dueAt > now) continue
    const seen = new Set(); let page = pages[item.pageId], live = !!page
    while (page) { if (page.trashed || seen.has(page.id)) { live = false; break }; seen.add(page.id); page = pages[page.parentId] }
    if (!live) continue
    next[item.id] = { ...item, firedAt: now }
    due.push(next[item.id])
    if (item.repeat && item.repeat !== 'none') {
      const id = uuid()
      next[id] = { ...item, id, dueAt: advanceSchedule(item.dueAt, item.repeat, now), createdAt: now, firedAt: null, readAt: null }
    }
  }
  return { notifications: next, due }
}
