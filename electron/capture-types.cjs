// Classificação de capturas no processo principal. A hierarquia segue o modelo de tipos do renderer.
const MAX_DEPTH = 8
const isId = value => typeof value === 'string' && value.length > 0

function typesById(meta) {
  const raw = meta?.settings?.objectTypes
  const types = new Map()
  if (Array.isArray(raw)) for (const type of raw) {
    if (isId(type?.id) && typeof type.name === 'string' && !types.has(type.id)) types.set(type.id, type)
  }
  return types
}

function listCaptureTypes(meta) {
  return Array.from(typesById(meta).values(), ({ id, name }) => ({ id, name }))
}

function validCaptureUrl(value) {
  if (typeof value !== 'string' || value.length > 4000) return false
  try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
}

function urlField(types, type) {
  const ancestors = []
  const seenTypes = new Set([type.id])
  function visit(current, depth) {
    if (depth > MAX_DEPTH || !Array.isArray(current.parentTypes)) return
    for (const parentId of current.parentTypes) {
      const parent = types.get(parentId)
      if (!parent || seenTypes.has(parentId)) continue
      seenTypes.add(parentId)
      ancestors.push(parent)
      visit(parent, depth + 1)
    }
  }
  visit(type, 0)
  const fields = new Map()
  for (const source of [...ancestors.reverse(), type]) {
    if (!Array.isArray(source.properties)) continue
    for (const field of source.properties) {
      if (isId(field?.id) && typeof field.name === 'string' && !fields.has(field.id)) fields.set(field.id, field)
    }
  }
  const urls = Array.from(fields.values()).filter(field => field.type === 'url')
  const named = urls.filter(field => field.name.trim().toLowerCase() === 'url')
  const candidates = named.length ? named : urls
  return candidates.length === 1 ? candidates[0] : undefined
}

function captureTypePatch(meta, typeId, { sourceUrl, requiredUrl = false } = {}) {
  if (typeId == null && !requiredUrl) return {}
  const types = typesById(meta)
  const type = types.get(typeId)
  if (!type) {
    throw Object.assign(new Error('Tipo indisponível. Escolha outro tipo. / Type unavailable. Choose another type.'), { code: 'CAPTURE_TYPE_UNAVAILABLE' })
  }
  const field = validCaptureUrl(sourceUrl) ? urlField(types, type) : undefined
  if (field) return { types: [type.id], typeProps: { [field.id]: sourceUrl } }
  if (requiredUrl) {
    throw Object.assign(new Error('Não foi possível identificar um campo URL compatível no tipo selecionado. / Could not identify a compatible URL field on the chosen type.'), { code: 'CAPTURE_TYPE_URL_UNAVAILABLE' })
  }
  return { types: [type.id] }
}

module.exports = { listCaptureTypes, captureTypePatch, validCaptureUrl }
