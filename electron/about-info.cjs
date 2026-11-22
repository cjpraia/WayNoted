const format = new Intl.DateTimeFormat('pt-BR', {
  timeZone: '-03:00',
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

function aboutInfo(version, metadata) {
  const instant = typeof metadata?.updatedAt === 'string' ? Date.parse(metadata.updatedAt) : NaN
  let updated = null
  if (Number.isFinite(instant)) {
    const { day, month, year, hour, minute } = Object.fromEntries(format.formatToParts(instant).map(({ type, value }) => [type, value]))
    updated = { date: `${day}/${month}/${year}`, time: `${hour}:${minute}` }
  }
  return {
    version, updated,
    localChanges: metadata?.localChanges === true,
    commitSubject: typeof metadata?.commitSubject === 'string' && metadata.commitSubject.trim() ? metadata.commitSubject : null,
  }
}

module.exports = { aboutInfo }
