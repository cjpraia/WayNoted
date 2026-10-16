/** Page blocks represent either an owned child or an independent linked source. */
export function pageBlockReferences(blocks) {
  const references = new Map()
  const walk = (items) => {
    for (const value of items) {
      if (!value || typeof value !== 'object') continue
      const block = value
      if (block.type === 'page' && typeof block.props?.pageId === 'string' && block.props.pageId) {
        const previous = references.get(block.props.pageId)
        const owned = block.props.ownership !== 'linked'
        const ownership = block.props.ownership === 'owned' || previous?.ownership === 'owned' ? 'owned' : previous?.owned && !owned ? previous.ownership : block.props.ownership ?? 'auto'
        references.set(block.props.pageId, { blockId: block.id ?? '', owned: owned || previous?.owned === true, ownership })
      }
      if (Array.isArray(block.children)) walk(block.children)
    }
  }
  walk(blocks)
  return references
}

export function ownedPageBlockChanges(ownerId, before, after, pages, at = Date.now()) {
  const previous = pageBlockReferences(before), current = pageBlockReferences(after)
  const changes = {}
  // Undo restores the original subtree; redo restores its page wrapper. Move
  // only the recorded owned children, never independent or manually moved links.
  for (const destination of Object.values(pages)) {
    const conversion = destination.blockConversion
    if (conversion?.sourceId !== ownerId || !Array.isArray(conversion.childIds)) continue
    const undo = previous.has(destination.id) && !current.has(destination.id)
    const redo = current.has(destination.id) && !previous.has(destination.id)
    if (!undo && !redo) continue
    if (redo && destination.trashed && destination.removedByBlock?.ownerId !== ownerId) continue
    for (const id of conversion.childIds) {
      const child = pages[id]
      if (!child || child.trashed || child.blockOwnerId === null || id === ownerId || id === destination.id) continue
      if (undo && current.get(id)?.owned && child.parentId === destination.id && child.blockOwnerId === destination.id) {
        changes[id] = { parentId: ownerId, blockOwnerId: ownerId }
      } else if (redo && previous.get(id)?.owned && !current.get(id)?.owned && child.parentId === ownerId && child.blockOwnerId === ownerId) {
        const visited = new Set([destination.id])
        let ancestor = destination.parentId
        while (ancestor && !visited.has(ancestor) && ancestor !== id) { visited.add(ancestor); ancestor = pages[ancestor]?.parentId }
        if (ancestor === id) continue
        changes[id] = { parentId: destination.id, blockOwnerId: destination.id }
      }
    }
  }
  const effective = (id) => changes[id] ? { ...pages[id], ...changes[id] } : pages[id]
  for (const page of Object.values(pages)) if (page.blockOwnerId === ownerId && page.parentId === ownerId && !previous.has(page.id)) {
    previous.set(page.id, { blockId: '', owned: true, ownership: 'owned' })
  }
  for (const [id, ref] of previous) {
    const page = effective(id)
    if (!ref.owned || current.get(id)?.owned || !page || page.parentId !== ownerId || page.trashed || page.blockOwnerId === null) continue
    // Old inline databases were created as children by this app. A legacy link
    // to an ordinary sidebar child is ambiguous and must never delete it.
    if (ref.ownership === 'auto' && !page.database && page.blockOwnerId !== ownerId) continue
    changes[id] = { trashed: true, trashedAt: at, favorite: false, removedByBlock: { ownerId, blockId: ref.blockId } }
  }
  for (const [id, ref] of current) {
    const page = effective(id)
    if (!ref.owned || !page?.trashed || page.parentId !== ownerId || page.removedByBlock?.ownerId !== ownerId) continue
    changes[id] = { trashed: false, trashedAt: null, removedByBlock: undefined }
  }
  return changes
}
