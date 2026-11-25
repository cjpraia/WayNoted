import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { actions, useStore } from '../../store'
import { createObject } from '../../objecttypes/actions'
import { t } from '../../i18n'
import type { Page } from '../../types'

interface CreationRequest {
  init: Partial<Page>
  parentId: string | null
  typeId?: string
}

const CREATE_PAGE = 'waynoted:create-page'

export function requestPageCreation(init: Partial<Page> = {}, parentId: string | null = null, typeId?: string) {
  window.dispatchEvent(new CustomEvent<CreationRequest>(CREATE_PAGE, { detail: { init, parentId, typeId } }))
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
  const { settings } = useStore()
  const [title, setTitle] = useState(request.init.title ?? '')
  const [typeId, setTypeId] = useState(request.typeId ?? '')
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
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
        const id = typeId ? createObject(typeId, {}, init, request.parentId) : actions.createPage(request.parentId, init)
        close()
        actions.openPage(id)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t('Não foi possível criar a página.', 'Could not create the page.'))
      }
    }}>
      <h2 id={heading}>{request.parentId ? t('Nova subpágina', 'New subpage') : t('Nova página', 'New page')}</h2>
      <label>{t('Título', 'Title')}<input autoFocus value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label>{t('Tipo', 'Type')}<select value={typeId} onChange={event => { setTypeId(event.target.value); setError('') }}>
        <option value="">{t('Sem tipo', 'Untyped')}</option>
        {typeId && !settings.objectTypes?.some(type => type.id === typeId) && <option value={typeId}>{t('Tipo indisponível', 'Type unavailable')}</option>}
        {settings.objectTypes?.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
      </select></label>
      {error && <p role="alert">{error}</p>}
      <div className="library-create-actions">
        <button type="button" onClick={close}>{t('Cancelar', 'Cancel')}</button>
        <button type="submit">{t('Criar', 'Create')}</button>
      </div>
    </form>
  </dialog>
}
