import PRODUCT from '../../shared/product.json' with { type: 'json' }
// Mensagens de erro humanas: o que aconteceu + uma saída (ação). Nunca despeja código ou stack.
export type ErrorKind = 'save' | 'import' | 'export' | 'password'
export type ErrorAction = 'retry' | 'backup' | 'reveal' | 'forgot' | 'smaller'
export interface HumanError { text: string; action: ErrorAction; actionLabel: string }
type Tr = (pt: string, en: string, vars?: Record<string, string | number>) => string

const raw = (cause: unknown) => cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause ?? '')

export function humanError(kind: ErrorKind, cause: unknown, tr: Tr): HumanError {
  const text = raw(cause)
  if (kind === 'password' || /WRONG_PASSWORD|WRONG_RECOVERY/.test(text)) {
    if (/TOO_MANY_ATTEMPTS/.test(text)) return { text: tr('Muitas tentativas seguidas. Aguarde um instante e tente de novo.', 'Too many attempts in a row. Wait a moment and try again.'), action: 'retry', actionLabel: tr('Tentar de novo', 'Try again') }
    return { text: tr('Essa senha não abriu o espaço. Confira maiúsculas e minúsculas e tente de novo.', 'That password did not open the space. Check upper and lower case and try again.'), action: 'forgot', actionLabel: tr('Usar chave de recuperação', 'Use recovery key') }
  }
  if (/ENOSPC|no space/i.test(text)) return kind === 'import'
    ? { text: tr('O disco está cheio, então a importação parou. Nada foi alterado.', 'The disk is full, so the import stopped. Nothing was changed.'), action: 'retry', actionLabel: tr('Tentar de novo', 'Try again') }
    : { text: tr('O disco está cheio e a última alteração não foi gravada. Ela continua aberta aqui.', 'The disk is full and your last change was not saved. It is still open here.'), action: 'backup', actionLabel: tr('Exportar uma cópia', 'Export a copy') }
  if (/EACCES|EPERM|permission/i.test(text)) return { text: tr(`O ${PRODUCT.name} não tem permissão para gravar nessa pasta. Escolha outro lugar.`, `${PRODUCT.name} has no permission to write to that folder. Pick another place.`), action: 'reveal', actionLabel: tr('Escolher outra pasta', 'Choose another folder') }
  if (/TOO_LARGE|4 GB/i.test(text)) return { text: tr('O arquivo é grande demais para importar de uma vez. Exporte o espaço em partes menores.', 'The file is too large to import at once. Export the workspace in smaller parts.'), action: 'smaller', actionLabel: tr('Escolher outro arquivo', 'Choose another file') }
  if (kind === 'import') return { text: tr("Não consegui ler esse arquivo. Confira se é uma exportação .zip ou uma pasta do Export Bundle.", "I could not read that file. Check that it is a .zip export or a Export Bundle folder."), action: 'retry', actionLabel: tr('Escolher outro arquivo', 'Choose another file') }
  if (kind === 'export') return { text: tr('A exportação não terminou. Suas páginas estão intactas.', 'The export did not finish. Your pages are untouched.'), action: 'retry', actionLabel: tr('Tentar de novo', 'Try again') }
  return { text: tr('Não consegui salvar agora. Suas alterações continuam abertas e serão gravadas assim que possível.', 'I could not save right now. Your changes are still open and will be saved as soon as possible.'), action: 'retry', actionLabel: tr('Tentar salvar de novo', 'Try saving again') }
}
