import PRODUCT from '../shared/product.json' with { type: 'json' }
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { ADHOC, appSignArgs, checkSignature, helperSignArgs, parseCodesignInfo, parseDesignatedRequirement, requirementDependsOnCdhash, sameIdentity, signingIdentity } from '../build/signing.mjs'

const adhocInfo = "Identifier=local.workspace.desktop\nSignature=adhoc\nCDHash=abc123\n"
const certInfo = `Identifier=local.workspace.desktop
Authority=${PRODUCT.name} Local Signing
TeamIdentifier=not set
CDHash=abc123
`
const stableDr = "Executable=/x\ndesignated => identifier \"local.workspace.desktop\" and certificate leaf = H\"deadbeef\"\n"
const adhocDr = 'designated => cdhash H"abc123"\n'

test('identidade: padrão ad-hoc, variável de ambiente sobrescreve, espaços são ignorados', () => {
  assert.equal(signingIdentity({}), ADHOC)
  assert.equal(signingIdentity({ WORKSPACE_SIGN_IDENTITY: '  ' }), ADHOC)
  assert.equal(signingIdentity({ WORKSPACE_SIGN_IDENTITY: ` ${PRODUCT.name} Local Signing ` }), `${PRODUCT.name} Local Signing`)
})

test('argumentos do codesign: mesma identidade no helper e no app; sem runtime endurecido por padrão', () => {
  const id = `${PRODUCT.name} Local Signing`
  const helper = helperSignArgs(id, '/h'), app = appSignArgs(id, '/a')
  assert.equal(helper[helper.indexOf('--sign') + 1], id)
  assert.equal(app[app.indexOf('--sign') + 1], id)
  assert.ok(helper.includes('--timestamp=none') && !helper.includes('runtime'))
  assert.ok(helper.includes("app.workspace.native"))
  assert.ok(appSignArgs(id, '/a', { hardened: true, entitlements: '/e.plist' }).includes('runtime'))
  assert.deepEqual(helperSignArgs(ADHOC, '/h'), ['--force', '--sign', '-', '--identifier', "app.workspace.native", '/h'])
  assert.ok(!appSignArgs(ADHOC, '/a', { hardened: true }).includes('runtime'), 'ad-hoc nunca usa runtime endurecido')
})

test('designated requirement não depende do cdhash quando há identidade; ad-hoc depende', () => {
  assert.equal(requirementDependsOnCdhash(parseDesignatedRequirement(adhocDr)), true)
  assert.equal(requirementDependsOnCdhash(parseDesignatedRequirement(stableDr)), false)
  const good = { identity: `${PRODUCT.name} Local Signing`, app: parseCodesignInfo(certInfo), helper: parseCodesignInfo(certInfo), appRequirement: parseDesignatedRequirement(stableDr), helperRequirement: parseDesignatedRequirement(stableDr) }
  assert.deepEqual(checkSignature(good), [])
  // build seguinte: cdhash diferente, requirement idêntico (é isso que mantém as permissões do macOS)
  assert.equal(parseDesignatedRequirement(stableDr), parseDesignatedRequirement(stableDr.replace('abc', 'zzz')))
  assert.ok(checkSignature({ ...good, appRequirement: parseDesignatedRequirement(adhocDr) }).some(p => /cdhash/.test(p)))
  assert.ok(checkSignature({ ...good, app: parseCodesignInfo(adhocInfo) }).some(p => /ad-hoc/.test(p)))
  assert.ok(checkSignature({ ...good, helper: parseCodesignInfo(adhocInfo) }).some(p => /workspace-native/.test(p)))
  assert.ok(checkSignature({ ...good, helper: parseCodesignInfo(certInfo.replace(`${PRODUCT.name} Local Signing`, 'Outro')) }).some(p => /identidades diferentes/.test(p)))
  assert.ok(checkSignature({ ...good, helperRequirement: '' }).some(p => /sem designated/.test(p)))
  assert.deepEqual(checkSignature({ identity: ADHOC, app: parseCodesignInfo(adhocInfo), helper: parseCodesignInfo(adhocInfo) }), [])
  assert.equal(sameIdentity(parseCodesignInfo(adhocInfo), parseCodesignInfo(adhocInfo)), true)
  assert.equal(sameIdentity(parseCodesignInfo(adhocInfo), parseCodesignInfo(certInfo)), false)
})

test('scripts de assinatura usam a mesma lógica e o script de identidade é idempotente e não é executado aqui', () => {
  const sign = fs.readFileSync('build/sign-app.mjs', 'utf8'), native = fs.readFileSync('build/build-native.mjs', 'utf8')
  assert.ok(/signingIdentity\(\)/.test(sign) && /signingIdentity\(\)/.test(native), "app e helper leem WORKSPACE_SIGN_IDENTITY")
  assert.ok(/helperSignArgs/.test(sign) && /helperSignArgs/.test(native))
  const script = fs.readFileSync('build/make-signing-identity.sh', 'utf8')
  assert.ok(/find-identity/.test(script) && /exit 0/.test(script), 'idempotente')
  assert.ok(/codeSign/.test(script) && /codeSigning/.test(script))
  if (process.platform !== 'win32') assert.ok((fs.statSync('build/make-signing-identity.sh').mode & 0o100) !== 0, 'executável')
})
