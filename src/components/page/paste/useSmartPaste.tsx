// Gancho do "colar já formatado" para o PageEditor: trata o evento de colagem, o atalho
// ⌘⇧V (colar como texto) e o aviso temporário que troca o resultado. Ver docs/USAGE.md.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { PasteFormatNotice, type PasteMode } from './PasteFormatNotice'
import { applyPlan, convertMarkdownInSlices, insertBlocks, insertPlain, runSmartPaste, schemaSupport, type PastePlan, type SmartPasteEditor } from './smartPaste.ts'

const NOTICE_MS = 8000
const PROGRESS_AFTER_MS = 300

interface Notice { plan: PastePlan; text: string; mode: PasteMode; doc: unknown; left: number; top: number; progress?: number; cancel?: { cancelled: boolean } }

function anchor(editor: SmartPasteEditor): { left: number; top: number } {
  try {
    const view = editor.prosemirrorView!
    const point = view.coordsAtPos(view.state.selection.from)
    if (!point.left && !point.bottom) throw new Error('sem layout')
    return { left: Math.max(12, Math.min(point.left, window.innerWidth - 380)), top: Math.max(12, Math.min(point.bottom + 8, window.innerHeight - 56)) }
  } catch {
    const rect = editor.prosemirrorView?.dom?.getBoundingClientRect?.()
    return { left: Math.max(12, (rect?.left ?? 40) + 16), top: Math.max(12, window.innerHeight - 64) }
  }
}

const docOf = (editor: SmartPasteEditor) => editor.prosemirrorView?.state.doc

export function useSmartPaste({ enabled, t }: { enabled: boolean; t: (pt: string, en: string) => string }) {
  const [notice, setNotice] = useState<Notice | null>(null)
  const noticeRef = useRef<Notice | null>(null)
  noticeRef.current = notice
  const editorRef = useRef<SmartPasteEditor | null>(null)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const plainUntil = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null }
  const dismiss = useCallback(() => { clearTimer(); noticeRef.current?.cancel && (noticeRef.current.cancel.cancelled = true); setNotice(null) }, [])
  const arm = useCallback(() => { clearTimer(); timer.current = setTimeout(() => setNotice((current) => current?.progress !== undefined ? current : null), NOTICE_MS) }, [])

  const show = (editor: SmartPasteEditor, plan: PastePlan, mode: PasteMode) => {
    const doc = docOf(editor)
    setNotice({ plan, text: plan.kind === 'default' ? '' : plan.text, mode, doc, ...anchor(editor) })
    // Logo após a colagem o DOM ainda não foi medido; reposiciona no próximo quadro.
    requestAnimationFrame(() => setNotice((current) => current && current.doc === doc ? { ...current, ...anchor(editor) } : current))
    arm()
  }

  /** Colagem grande: converte em fatias sem bloquear; mostra progresso depois de 300 ms. */
  const pasteLarge = (editor: SmartPasteEditor, plan: Extract<PastePlan, { kind: 'markdown' }>) => {
    const cancel = { cancelled: false }
    const started = Date.now()
    const position = anchor(editor)
    let shown = false
    void convertMarkdownInSlices(plan.markdown, schemaSupport(editor), (done) => {
      if (cancel.cancelled) return
      if (shown || Date.now() - started > PROGRESS_AFTER_MS) { shown = true; setNotice({ plan, text: plan.text, mode: 'formatted', doc: null, ...position, progress: done, cancel }) }
    }, cancel).then((blocks) => {
      if (!blocks || cancel.cancelled || !editor.isEditable) return
      insertBlocks(editor, blocks)
      show(editor, plan, 'formatted')
    })
    setNotice(null)
  }

  const handle = useCallback((event: ClipboardEvent, editor: SmartPasteEditor, defaultPasteHandler: () => boolean | undefined): boolean | undefined => {
    editorRef.current = editor
    const plain = Date.now() < plainUntil.current
    plainUntil.current = 0
    dismiss()
    const result = runSmartPaste(event, editor, defaultPasteHandler, { convert: enabledRef.current, plain })
    if (result.large && result.plan.kind === 'markdown') pasteLarge(editor, result.plan)
    else if (result.converted) show(editor, result.plan, 'formatted')
    return result.handled
  }, [dismiss])

  const choose = (mode: PasteMode) => {
    const editor = editorRef.current, current = noticeRef.current
    if (!editor || !current) return
    if (current.progress !== undefined) {
      // Cancelou a conversão em andamento: cola o texto simples.
      if (current.cancel) current.cancel.cancelled = true
      insertPlain(editor, current.text)
      show(editor, current.plan, 'plain')
      return
    }
    const doc = docOf(editor) as { eq?: (other: unknown) => boolean } | undefined
    if (!doc?.eq?.(current.doc)) { dismiss(); return }
    editor.undo()
    if (mode === 'plain') insertPlain(editor, current.text)
    else applyPlan(editor, current.plan)
    setNotice({ ...current, mode, doc: docOf(editor), ...anchor(editor) })
    arm()
  }

  // Qualquer tecla ou clique fora fecha o aviso (nunca bloqueia a digitação).
  useEffect(() => {
    if (!notice || notice.progress !== undefined) return
    const onKey = (event: KeyboardEvent) => { if (!['Shift', 'Meta', 'Control', 'Alt', 'CapsLock'].includes(event.key)) dismiss() }
    const onPointer = (event: PointerEvent) => { if (!(event.target as Element | null)?.closest?.('.pg-paste-format-notice')) dismiss() }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onPointer, true)
    return () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onPointer, true) }
  }, [notice, dismiss])
  useEffect(() => () => clearTimer(), [])

  // Electron: o menu Editar (⌘⇧V) avisa por aqui e dispara uma colagem nativa de texto simples.
  useEffect(() => {
    const onPlain = () => { plainUntil.current = Date.now() + 1000 }
    window.addEventListener('np:paste-plain', onPlain)
    return () => window.removeEventListener('np:paste-plain', onPlain)
  }, [])

  /** ⌘⇧V (e ⌥⇧⌘V, "Colar e manter o estilo"): a próxima colagem entra como texto simples. */
  const onKeyDownCapture = useCallback((event: ReactKeyboardEvent, editor: SmartPasteEditor) => {
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key.toLowerCase() !== 'v' && event.code !== 'KeyV') return
    editorRef.current = editor
    plainUntil.current = Date.now() + 1000
    // O Chromium cola sozinho com ⌘⇧V; no Electron (sem item de menu com esse atalho) nada
    // acontece, então pedimos a colagem — o evento chega marcado como "texto simples".
    setTimeout(() => {
      if (plainUntil.current && Date.now() < plainUntil.current && editor.isEditable) {
        try { document.execCommand('paste') } catch { /* navegador sem permissão */ }
      }
    }, 60)
  }, [])

  const element = notice ? <PasteFormatNotice left={notice.left} top={notice.top} mode={notice.mode} progress={notice.progress}
    onChoose={choose} onCancel={() => choose('plain')} onHover={(inside) => { if (inside) clearTimer(); else arm() }} t={t} /> : null

  return { handle, onKeyDownCapture, element }
}
