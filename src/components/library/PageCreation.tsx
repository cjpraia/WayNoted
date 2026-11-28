import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { actions, useStore } from '../../store'
import { createObject, createType } from '../../objecttypes/actions'
import { findTypeByName } from '../../objecttypes/model'
import { openTypeCollection } from '../../objecttypes/ui'
import { t } from '../../i18n'
import type { Page } from '../../types'
import { protectedTitle } from '../../security/pageLock'
import { Select } from '../ui/Select'

interface CreationRequest {
  kind: 'page' | 'database' | 'type'
  init: Partial<Page>
  parentId: string | null
  typeId?: string
}

const CREATE_PAGE = 'waynoted:create-page'

export function requestPageCreation(init: Partial<Page> = {}, parentId: string | null = null, typeId?: string) {
  window.dispatchEvent(new CustomEvent<CreationRequest>(CREATE_PAGE, { detail: { kind: 'page', init, parentId, typeId } }))
}

export function requestWorkspaceCreation(kind: CreationRequest['kind']) {
  window.dispatchEvent(new CustomEvent<CreationRequest>(CREATE_PAGE, { detail: { kind, init: {}, parentId: null } }))
}

export function PageCreationHost() {
  const [request, setRequest] = useState<CreationRequest | null>(null)
  useEffect(() => {
    const open = (event: Event) => setRequest((event as CustomEvent<CreationRequest>).detail)
    window.addEventListener(CREATE_PAGE, open)
    return () => window.removeEventListener(CREATE_PAGE, open)
  }, [])
  return request && <PageCreationDialog request={request} close={() => setRequest(null)} />
}

function PageCreationDialog({ request, close }: { request: CreationRequest; close: () => void }) {
  const { settings, pages } = useStore()
  const headingText = request.kind === 'type' ? t('Novo tipo', 'New type')
    : request.kind === 'database' ? t('Novo banco de dados', 'New database')
    : request.parentId ? t('Nova subpágina', 'New subpage') : t('Nova página', 'New page')
  const parent = request.parentId ? pages[request.parentId] : undefined
  const location = parent
    ? protectedTitle(parent, t('Página protegida', 'Protected page')) ?? (parent.title.trim() || t('Sem título', 'Untitled'))
    : t('Workspace · nível principal', 'Workspace · top level')
  const [title, setTitle] = useState(request.init.title ?? '')
  const [typeId, setTypeId] = useState(request.typeId ?? '')
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const typeLabel = useId()
  useLayoutEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])
  return <dialog className="library-create" ref={dialog} aria-labelledby={heading} onCancel={event => { event.preventDefault(); close() }}>
    <form onSubmit={event => {
      event.preventDefault()
      try {
        const init = { ...request.init, title: title.trim() }
        if (request.kind === 'type') {
          if (!init.title) throw new Error(t('Digite um nome para o tipo.', 'Enter a name for the type.'))
          if (findTypeByName(settings.objectTypes ?? [], init.title)) throw new Error(t('Já existe um tipo com esse nome.', 'A type with this name already exists.'))
          const id = createType({ name: init.title })
          if (!id) throw new Error(t('Não foi possível criar o tipo.', 'Could not create the type.'))
          close()
          openTypeCollection(id)
          return
        }
        const id = request.kind === 'database' ? actions.createDatabase(null, 'table', init)
          : typeId ? createObject(typeId, {}, init, request.parentId) : actions.createPage(request.parentId, init)
        close()
        actions.openPage(id)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t('Não foi possível criar o item.', 'Could not create the item.'))
      }
    }}>
      <h2 id={heading}>{headingText}</h2>
      <label>{request.kind === 'page' ? t('Título', 'Title') : t('Nome', 'Name')}<input autoFocus required={request.kind === 'type'} value={title} onChange={event => { setTitle(event.target.value); setError('') }} /></label>
      {request.kind === 'page' && <div className="library-create-type">
        <span id={typeLabel}>{t('Tipo', 'Type')}</span>
        <Select block aria-labelledby={typeLabel} value={typeId} onChange={event => { setTypeId(event.target.value); setError('') }}>
          <option value="">{t('Sem tipo', 'Untyped')}</option>
          {typeId && !settings.objectTypes?.some(type => type.id === typeId) && <option value={typeId} disabled>{t('Tipo indisponível', 'Type unavailable')}</option>}
          {settings.objectTypes?.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
        </Select>
      </div>}
      {request.kind === 'type' ? <p>{t('Cria uma coleção para as páginas que tiverem esse tipo.', 'Creates a collection for pages of this type.')}</p>
        : <p>{t('Local: {name}', 'Location: {name}', { name: location })}</p>}
      {error && <p role="alert">{error}</p>}
      <div className="library-create-actions">
        <button type="button" onClick={close}>{t('Cancelar', 'Cancel')}</button>
        <button type="submit">{t('Criar', 'Create')}</button>
      </div>
    </form>
  </dialog>
}
