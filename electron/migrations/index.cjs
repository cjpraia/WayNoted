const PRODUCT = require('../../shared/product.json')
// Versão de esquema do meta.json (docs/DEVELOPMENT.md F2). Dados sem `schemaVersion` valem v1.
// Cada migração sobe UMA versão e só mexe na forma do meta; novas versões entram no fim da lista.
const migrations = [
  // v1 -> v2: carimba a versão. A estrutura de v1 já é aceita pelos validadores tolerantes.
  { to: 2, run: meta => meta },
]
const CURRENT_SCHEMA_VERSION = migrations[migrations.length - 1].to

const versionOf = meta => (Number.isInteger(meta?.schemaVersion) && meta.schemaVersion >= 1 ? meta.schemaVersion : 1)

function schemaTooNewError(directory, found) {
  const where = directory ? ` ${directory}` : ''
  return Object.assign(new Error(
    `SCHEMA_TOO_NEW: Estes dados (pasta:${where}) foram criados por uma versão mais nova do ${PRODUCT.name} (esquema ${found}; este app entende até ${CURRENT_SCHEMA_VERSION}). Nada foi alterado. Atualize o app para abrir. / ` +
    `This data (folder:${where}) was created by a newer ${PRODUCT.name} (schema ${found}; this app supports up to ${CURRENT_SCHEMA_VERSION}). Nothing was changed. Update the app to open it.`), { code: 'SCHEMA_TOO_NEW', schemaVersion: found, supported: CURRENT_SCHEMA_VERSION })
}

/** Portão de downgrade: um app antigo nunca lê nem regrava dados de esquema mais novo. */
function assertSchemaReadable(meta, directory) {
  const found = versionOf(meta)
  if (meta && found > CURRENT_SCHEMA_VERSION) throw schemaTooNewError(directory, found)
}

/** Aplica as migrações pendentes sem mutar a entrada. Idempotente. */
function migrateMeta(meta, list = migrations) {
  const from = versionOf(meta)
  let next = meta, version = from
  for (const migration of list) if (migration.to > version) { next = migration.run(structuredClone(next)); version = migration.to }
  return { meta: { ...next, schemaVersion: Math.max(version, from) }, from, to: Math.max(version, from), changed: version > from || meta?.schemaVersion !== version }
}

module.exports = { migrations, CURRENT_SCHEMA_VERSION, versionOf, assertSchemaReadable, migrateMeta, schemaTooNewError }
