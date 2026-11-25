const format = new Intl.DateTimeFormat('pt-BR', {
  timeZone: '-03:00',
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

function formattedDate(value) {
  const instant = typeof value === 'string' ? Date.parse(value) : NaN
  if (!Number.isFinite(instant)) return null
  const { day, month, year, hour, minute } = Object.fromEntries(format.formatToParts(instant).map(({ type, value }) => [type, value]))
  return { date: day + '/' + month + '/' + year, time: hour + ':' + minute }
}

function aboutInfo(version, metadata) {
  return {
    version, updated: formattedDate(metadata?.updatedAt), built: formattedDate(metadata?.builtAt),
    baseCommit: /^[a-f0-9]{8,40}$/.test(metadata?.baseCommit ?? '') ? metadata.baseCommit : null,
    localChanges: metadata?.localChanges === true,
    commitSubject: typeof metadata?.commitSubject === 'string' && metadata.commitSubject.trim() ? metadata.commitSubject : null,
  }
}

module.exports = { aboutInfo }
