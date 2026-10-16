// JXA (osascript -l JavaScript) — D3b: lê o Notas da Apple SOMENTE para leitura. Nunca cria, altera nem apaga notas.
// Uso: osascript -l JavaScript apple-notes.js folders
//      osascript -l JavaScript apple-notes.js notes <folderId> <offset> <limit>
// A saída é um JSON (string) em stdout. Notas protegidas por senha nunca têm o corpo lido.
// ⚠ Escrito sem acesso a um Mac com notas reais: as chamadas abaixo seguem o dicionário de scripting do Notas,
// mas precisam ser validadas no app real (ver docs/LOCAL-INTEGRATIONS.md).
function run(argv) {
  const Notes = Application('Notes')
  const mode = argv[0]
  if (mode === 'folders') {
    const accounts = [], folders = [], seen = {}
    const protectedCount = folder => {
      try { return folder.notes.passwordProtected().filter(Boolean).length } catch (e) { return 0 }
    }
    Notes.accounts().forEach(function (account) {
      const accountId = account.id()
      accounts.push({ id: accountId, name: String(account.name()) })
      const walk = function (list, parentId) {
        list.forEach(function (folder) {
          const id = folder.id()
          if (seen[id]) return
          seen[id] = true
          let notes = 0
          try { notes = folder.notes.length } catch (e) { notes = 0 }
          folders.push({ id: id, name: String(folder.name()), accountId: accountId, parentId: parentId, notes: notes, locked: protectedCount(folder) })
          let children = []
          try { children = folder.folders() } catch (e) { children = [] }
          walk(children, id)
        })
      }
      let top = []
      try { top = account.folders() } catch (e) { top = [] }
      walk(top, null)
    })
    return JSON.stringify({ accounts: accounts, folders: folders })
  }
  if (mode === 'notes') {
    const folderId = argv[1], offset = Math.max(0, parseInt(argv[2], 10) || 0), limit = Math.max(1, Math.min(50, parseInt(argv[3], 10) || 20))
    const folder = Notes.folders.byId(folderId)
    const total = folder.notes.length
    const out = []
    for (let i = offset; i < Math.min(total, offset + limit); i++) {
      const note = folder.notes[i]
      const locked = !!note.passwordProtected()
      const item = { id: String(note.id()), name: String(note.name()), folderId: folderId, locked: locked, body: '', created: null, modified: null }
      try { item.created = note.creationDate().toISOString() } catch (e) { item.created = null }
      try { item.modified = note.modificationDate().toISOString() } catch (e) { item.modified = null }
      if (!locked) { try { item.body = String(note.body()) } catch (e) { item.body = '' } }
      out.push(item)
    }
    return JSON.stringify({ total: total, offset: offset, notes: out })
  }
  throw new Error('modo inválido')
}
