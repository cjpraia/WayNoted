import PRODUCT from '../shared/product.json' with { type: 'json' }
// Lógica pura de assinatura (sem executar nada): testada com mocks em tests/signing.test.mjs.
// Identidade: WORKSPACE_SIGN_IDENTITY (nome ou SHA-1 do certificado no Acesso às Chaves). Padrão "-" = ad-hoc.
export const ADHOC = '-'
export const NATIVE_IDENTIFIER = PRODUCT.nativeBundleId

export function signingIdentity(env = process.env) {
  const value = String(env.WORKSPACE_SIGN_IDENTITY ?? '').trim()
  return value || ADHOC
}
export const isAdhoc = identity => identity === ADHOC

export const ADHOC_WARNING = [
  '[sign] AVISO: assinatura ad-hoc ("-"). O macOS identifica o app pelo cdhash, que muda a CADA build:',
  '[sign] permissões (Calendário, microfone, reconhecimento de fala) e o Acesso às Chaves pedem de novo depois de cada instalação.',
  '[sign] Para manter as permissões: rode build/make-signing-identity.sh uma vez e use WORKSPACE_SIGN_IDENTITY="Workspace Local Signing" (veja docs/DISTRIBUTION.md).',
].join('\n')

/** Argumentos do `codesign` para o helper nativo. */
export function helperSignArgs(identity, path, { hardened = false, entitlements } = {}) {
  return ['--force', '--sign', identity, '--identifier', NATIVE_IDENTIFIER, ...extraArgs(identity, { hardened, entitlements }), path]
}
/** Argumentos do `codesign` para o .app inteiro. */
export function appSignArgs(identity, app, { hardened = false, entitlements } = {}) {
  return ['--force', '--deep', '--sign', identity, ...extraArgs(identity, { hardened, entitlements }), app]
}
function extraArgs(identity, { hardened, entitlements }) {
  if (isAdhoc(identity)) return []
  // Sem carimbo de tempo por padrão (certificado local não tem servidor de carimbo); o hardened runtime é opt-in
  // porque exige entitlements corretos e, com certificado auto-assinado, o Electron não carrega seus frameworks.
  const args = ['--timestamp=none']
  if (hardened) args.push('--options', 'runtime', ...(entitlements ? ['--entitlements', entitlements] : []))
  return args
}

/** Interpreta a saída de `codesign -dv --verbose=2` (vai para stderr). */
export function parseCodesignInfo(text) {
  const lines = String(text).split('\n')
  const pick = key => lines.filter(l => l.startsWith(`${key}=`)).map(l => l.slice(key.length + 1).trim())
  const signature = pick('Signature')[0] ?? ''
  return { identifier: pick('Identifier')[0] ?? '', adhoc: signature === 'adhoc' || /flags=.*adhoc/.test(text), authorities: pick('Authority'), teamIdentifier: pick('TeamIdentifier')[0] ?? '', cdhash: pick('CDHash')[0] ?? '' }
}
/** helper e app foram assinados com a mesma identidade? (mesma cadeia de Authority, ou ambos ad-hoc) */
export function sameIdentity(a, b) {
  if (a.adhoc || b.adhoc) return a.adhoc && b.adhoc
  return a.authorities.length > 0 && a.authorities[0] === b.authorities[0]
}
/** Saída de `codesign -d -r- app`: o designated requirement. Estável = não prende o cdhash. */
export function parseDesignatedRequirement(text) {
  const line = String(text).split('\n').find(l => l.startsWith('designated =>'))
  return line ? line.slice('designated =>'.length).trim() : ''
}
export const requirementDependsOnCdhash = requirement => /\bcdhash\b/i.test(requirement)

/**
 * Confere o resultado da assinatura. Devolve a lista de problemas (vazia = ok).
 * Com identidade real o requirement deve ser estável (identificador + certificado) e o helper precisa ter a mesma identidade.
 */
export function checkSignature({ identity, app, helper, appRequirement, helperRequirement }) {
  const problems = []
  if (isAdhoc(identity)) {
    if (!app.adhoc) problems.push('esperava assinatura ad-hoc no app')
    return problems
  }
  if (app.adhoc) problems.push("o app saiu com assinatura ad-hoc apesar de WORKSPACE_SIGN_IDENTITY")
  if (helper.adhoc) problems.push("o workspace-native saiu com assinatura ad-hoc")
  if (!sameIdentity(app, helper)) problems.push("app e workspace-native foram assinados com identidades diferentes")
  for (const [name, requirement] of [['app', appRequirement], ["workspace-native", helperRequirement]]) {
    if (!requirement) problems.push(`sem designated requirement para ${name}`)
    else if (requirementDependsOnCdhash(requirement)) problems.push(`o designated requirement de ${name} depende do cdhash (muda a cada build): ${requirement}`)
  }
  return problems
}
