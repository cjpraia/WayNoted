// Botão "Ditado" na barra de formatação: começa a ditar num parágrafo abaixo do bloco selecionado.
import { useBlockNoteEditor, useComponentsContext } from '@blocknote/react'
import { Mic } from 'lucide-react'
import { useI18n } from '../../i18n'
import type { PageEditorType } from '../page/schema'
import { toggleDictation } from './dictationSession'

export function DictationToolbarButton() {
  const Components = useComponentsContext()!
  const editor = useBlockNoteEditor() as unknown as PageEditorType
  const { t } = useI18n()
  if (typeof window === 'undefined' || !window.api?.dictationStart) return null
  const label = t('Ditado (no dispositivo)', 'Dictation (on device)')
  return <Components.FormattingToolbar.Button className="bn-button pg-ft-button" data-test="pg-dictation" label={label} mainTooltip={label} secondaryTooltip="Esc" icon={<Mic size={16} strokeWidth={1.75} />}
    onClick={() => { const blocks = editor.getSelection()?.blocks; void toggleDictation(editor, { blockId: blocks?.at(-1)?.id }) }} />
}
