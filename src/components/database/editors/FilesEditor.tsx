import { useRef } from 'react'
import { api } from '../../../store'
import { useI18n } from '../../../i18n'
import type { FileValue, PropValue } from '../../../types'
import { isFileArray } from '../derived'
import { DbPopover, type DbAnchor } from '../ui/Popover'
import type { EditorCloseReason } from './PropertyEditor'

const MAX_FILE = 5 * 1024 * 1024

export function FilesEditor({ value, anchor, onChange, onClose }: { value: PropValue; anchor: DbAnchor; onChange: (value: PropValue) => void; onClose: (reason: EditorCloseReason) => void }) {
  const { t } = useI18n()
  const input = useRef<HTMLInputElement>(null)
  const files = isFileArray(value) ? value : []
  const add = (incoming: FileValue[]) => onChange([...files, ...incoming])
  const pick = async () => {
    if (api.pickFiles) { add(await api.pickFiles()); return }
    input.current?.click()
  }
  const importBrowserFiles = async (selected: FileList | null) => {
    if (!selected) return
    const next: FileValue[] = []
    for (const file of Array.from(selected)) {
      if (file.size > MAX_FILE) continue
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file) })
      next.push({ id: crypto.randomUUID(), name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, data })
    }
    add(next)
  }
  return <DbPopover anchor={anchor} onClose={() => onClose('outside')} label={t('Arquivos locais', 'Local files')}><div className="db-file-editor">
    {files.map((file) => <div key={file.id}><a href={file.data} download={file.name}>{file.name}</a><small>{Math.ceil(file.size / 1024)} KB</small><button type="button" aria-label={t('Remover {name}', 'Remove {name}', { name: file.name })} onClick={() => onChange(files.filter((item) => item.id !== file.id))}>×</button></div>)}
    <input ref={input} type="file" multiple hidden onChange={(event) => { void importBrowserFiles(event.target.files); event.target.value = '' }} />
    <button type="button" className="db-file-add" onClick={() => void pick()}>{t('Adicionar arquivo deste dispositivo', 'Add file from this device')}</button>
    <small>{t('Arquivos ficam no armazenamento local (até 5 MB por arquivo).', 'Files stay in local storage (up to 5 MB each).')}</small>
  </div></DbPopover>
}
