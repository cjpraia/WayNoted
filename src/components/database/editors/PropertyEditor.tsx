// Editor genérico do valor de uma propriedade, ancorado num elemento (célula da tabela,
// linha do painel de propriedades…). Escolhe o editor certo pelo tipo.
import { useEffect, useRef } from 'react'
import type { Property, PropValue } from '../../../types'
import type { DbAnchor } from '../ui/Popover'
import { TextEditor } from './TextEditor'
import { OptionsEditor } from './OptionsEditor'
import { DateEditor } from './DateEditor'
import { RelationEditor } from './RelationEditor'
import { FilesEditor } from './FilesEditor'
import { PlaceEditor } from './PlaceEditor'
import { RichTextEditor } from './RichTextEditor'
import './editors.css'

/** Como o editor foi fechado; `tab`/`shiftTab` permitem ir para a célula vizinha. */
export type EditorCloseReason = 'enter' | 'escape' | 'outside' | 'tab' | 'shiftTab'

export interface PropertyEditorProps {
  /** Id da página-banco (para editar opções no esquema). */
  dbId: string
  property: Property
  /** Valor atual (para `title`, o `page.title`). Deve vir sempre fresco do store. */
  value: PropValue
  /** Grava o novo valor. Título/texto/número/URL gravam ao fechar; opções e datas, imediatamente. */
  onChange: (value: PropValue) => void
  onClose: (reason: EditorCloseReason) => void
  /** Elemento (preferível: o editor acompanha a rolagem) ou retângulo onde ancorar. */
  anchor: DbAnchor
  /** Linha editada (seleção dependente e filtros de relação usam os outros valores dela). */
  rowId?: string
  /** Teclado: texto digitado sobre a célula; o editor abre com ele no lugar do valor atual. */
  seed?: string
}

/**
 * Para `checkbox` não há popover: o valor é alternado ao montar e o editor fecha em seguida
 * (os chamadores normalmente alternam direto no clique, sem montar o editor).
 */
export function PropertyEditor(props: PropertyEditorProps) {
  const { property } = props
  switch (property.type) {
    case 'title':
    case 'number':
    case 'url':
    case 'email':
    case 'phone':
    case 'person':
      return <TextEditor {...props} />
    case 'text':
      return <RichTextEditor {...props} />
    case 'select':
    case 'status':
    case 'multiSelect':
      return <OptionsEditor {...props} />
    case 'date':
      return <DateEditor {...props} />
    case 'checkbox':
      return <CheckboxToggle {...props} />
    case 'relation':
      return <RelationEditor {...props} />
    case 'files':
      return <FilesEditor {...props} />
    case 'place':
      return <PlaceEditor {...props} />
    case 'formula':
    case 'rollup':
    case 'createdTime':
    case 'updatedTime':
    case 'createdBy':
    case 'updatedBy':
    case 'button':
    case 'uniqueId':
      return null
  }
}

function CheckboxToggle({ value, onChange, onClose }: PropertyEditorProps) {
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    onChange(value !== true)
    onClose('enter')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}
