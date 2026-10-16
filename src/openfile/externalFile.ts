// B5 — utilidades puras do arquivo avulso aberto: fila de arquivos e mensagens de erro legíveis.
import type { ExternalFile } from '../types'

type Translate = (pt: string, en: string) => string

/**
 * Entrada de um arquivo na fila: o mesmo `fileId` não duplica (reabrir o mesmo caminho atualiza o texto),
 * mas se o do início tem edições não salvas o texto novo não substitui o que o usuário está editando.
 */
export function nextQueue(list: ExternalFile[], file: ExternalFile, currentIsDirty: boolean): ExternalFile[] {
  const at = list.findIndex(item => item.fileId === file.fileId)
  if (at < 0) return [...list, file].slice(0, 30)
  if (at === 0 && currentIsDirty) return list
  return list.map((item, index) => index === at ? file : item)
}

/** Códigos do main (electron/open-file.cjs) → texto do usuário, nos dois idiomas. */
export function fileErrorMessage(error: unknown, t: Translate): string {
  const raw = String((error as { message?: string })?.message ?? error)
  const code = /(FILE_[A-Z0-9_]+)/.exec(raw)?.[1]
  switch (code) {
    case 'FILE_TOO_LARGE': return t('O arquivo passa de 10 MB.', 'The file exceeds 10 MB.')
    case 'FILE_BINARY': return t('O arquivo não parece ser texto.', 'The file does not look like text.')
    case 'FILE_NOT_UTF8': return t('O arquivo não está em UTF-8. Converta-o e abra de novo.', 'The file is not UTF-8. Convert it and open it again.')
    case 'FILE_TYPE': return t('Só arquivos .md, .markdown ou .txt podem ser abertos.', 'Only .md, .markdown or .txt files can be opened.')
    case 'FILE_UNKNOWN': return t('Este arquivo não está mais aberto.', 'This file is no longer open.')
    case 'FILE_UNREADABLE': return t('Não foi possível ler ou gravar o arquivo. Confira as permissões.', 'The file could not be read or written. Check its permissions.')
    default: return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  }
}
