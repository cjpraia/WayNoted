// Armazenamento do Chromium (IndexedDB, Cache Storage, service workers) é texto claro em
// <userData>/IndexedDB etc. e o LevelDB só compacta/descarta valores antigos depois de um tempo:
// um texto digitado antes de proteger o espaço/página continuaria legível em `000003.log`.
// Aqui ficam o expurgo (processo principal) e a varredura de resíduos em disco.
const fs = require('node:fs')
const path = require('node:path')

const STORAGES = ['indexdb', 'cachestorage', 'serviceworkers']
// Pastas de userData que o Chromium usa para esses armazenamentos (por origem).
const RESIDUE_DIRS = ['IndexedDB', 'Service Worker', 'Cache Storage']

/** Arquivos (relativos a userData) que ainda existem nas pastas de armazenamento do Chromium. */
function residualFiles(userData, dirs = RESIDUE_DIRS) {
  const found = []
  const walk = (base, rel) => {
    let entries
    try { entries = fs.readdirSync(path.join(base, rel), { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const next = path.join(rel, entry.name)
      if (entry.isDirectory()) walk(base, next); else found.push(next)
    }
  }
  for (const dir of dirs) walk(userData, dir)
  return found
}

/**
 * Remove do disco as pastas de origem (`*.indexeddb.leveldb`/`*.blob`, workers, caches).
 * Só é seguro com o Chromium sem conexões abertas a elas (início do app, depois de
 * `clearStorageData`, ou ao sair); o conteúdo é só cache reconstruível.
 */
function scrubResidue(userData, dirs = RESIDUE_DIRS) {
  let removed = 0
  for (const dir of dirs) {
    const base = path.join(userData, dir)
    let entries
    try { entries = fs.readdirSync(base, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      try { fs.rmSync(path.join(base, entry.name), { recursive: true, force: true }); removed++ } catch { /* em uso: o próximo expurgo tenta de novo */ }
    }
  }
  return removed
}

/**
 * Descarta IndexedDB/Cache Storage/service workers da sessão e confirma no disco.
 * `session.clearStorageData` apaga a base inteira da origem (inclusive o `.log`). Nunca apaga
 * arquivos à mão aqui: com uma conexão viva isso corrompe o LevelDB (a varredura manual
 * `scrubResidue` é só para o início/saída do app). Se sobrar algo, limpa de novo pela API.
 */
async function purgeBrowserStorage(session, userData) {
  const clear = async () => {
    try { await session?.clearStorageData({ storages: STORAGES }) } catch (error) { console.error(error) }
    try { await session?.flushStorageData?.() } catch { /* sessão já encerrada */ }
  }
  await clear()
  let left = userData ? residualFiles(userData, ['IndexedDB']) : []
  if (left.length) {
    await new Promise(resolve => setTimeout(resolve, 150))
    await clear()
    left = residualFiles(userData, ['IndexedDB'])
  }
  return { residual: left }
}

module.exports = { STORAGES, RESIDUE_DIRS, residualFiles, scrubResidue, purgeBrowserStorage }
