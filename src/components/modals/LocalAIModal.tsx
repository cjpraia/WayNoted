import { useEffect, useRef, useState } from 'react'
import { Bot, Copy, Plus, RefreshCw, Square, X } from 'lucide-react'
import { actions, api, selectors, getState } from '../../store'
import { useI18n } from '../../i18n'
import { blocksToText } from '../page/util'
import { propertySearchText } from './search.mts'
import { runAI } from '../../ai/client.ts'
import { getAIBridge } from '../../ai/bridge.ts'
import { aiErrorMessage } from '../../ai/errors.ts'
import { providerFor, refreshAISettings, useAISettings } from '../../ai/settingsStore.ts'
import { PROVIDER_LABEL, isCloud } from '../../ai/types.ts'
import { AIBadge } from '../ai/AIBadge'
import './LocalAIModal.css'
import { Select } from '../ui/Select'

// Assistente de IA da página (docs/AI.md §6): mesmo fluxo de antes (prévia antes de inserir),
// agora pelo provedor configurado para "Assistente" — Ollama local por padrão.
type Operation = 'write' | 'summarize' | 'translate' | 'ask' | 'autofill'
export function LocalAIModal({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const {t,locale}=useI18n()
  const settings=useAISettings()
  const provider=providerFor('assistant',settings)
  const cloud=isCloud(provider)
  const [models,setModels]=useState<string[]>([]),[model,setModel]=useState('')
  const [operation,setOperation]=useState<Operation>('write'),[prompt,setPrompt]=useState('')
  const [propertyId,setPropertyId]=useState('')
  const [context,setContext]=useState(''),[includeContext,setIncludeContext]=useState(true)
  const [answer,setAnswer]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [loading,setLoading]=useState(false),[loadingContext,setLoadingContext]=useState(true),[generating,setGenerating]=useState(false),[saving,setSaving]=useState(false)
  const active=useRef(true),box=useRef<HTMLDivElement>(null),controller=useRef<AbortController|null>(null)
  const insertion=useRef<{text:string;blocks:unknown[]}|null>(null)
  const locked=selectors.page(pageId)?.locked
  const page=selectors.page(pageId)
  const textProperties=(page?.parentId?selectors.database(page.parentId)?.properties:[])?.filter(property=>property.type==='text')||[]
  const refresh=async()=>{
    setLoading(true);setError('')
    try {
      const bridge=getAIBridge()
      if(!bridge)throw new Error('AI_UNAVAILABLE')
      const current=settings??await refreshAISettings()
      const id=providerFor('assistant',current)
      // Ollama: modelos instalados neste Mac. Nuvem: o modelo escolhido em Configurações → IA.
      const available=isCloud(id)?(current?.models[id]?[current.models[id]]:[]):(await bridge.aiListModels('ollama')).map(item=>item.id)
      if(!active.current)return
      setModels(available);setModel(old=>available.includes(old)?old:(!isCloud(id)&&current?.models.ollama&&available.includes(current.models.ollama)?current.models.ollama:available[0]||''))
      if(!available.length)setNotice(isCloud(id)?t('Escolha um modelo de {name} em Configurações → IA.','Choose a {name} model in Settings → AI.',{name:PROVIDER_LABEL[id]}):t('Nenhum modelo instalado foi encontrado. Configure um modelo no seu Ollama local e atualize a lista.', 'No installed models were found. Configure a model in your local Ollama and refresh the list.'))
      else setNotice('')
    }catch(cause){if(active.current)setError(aiErrorMessage(cause,t))}
    finally{if(active.current)setLoading(false)}
  }
  useEffect(()=>{
    active.current=true
    const previous=document.activeElement as HTMLElement|null
    box.current?.focus()
    void actions.flushAll().then(()=>api.loadDoc(pageId)).then(blocks=>{if(active.current){const page=selectors.page(pageId);setContext([page?.title,page?.text||blocksToText(blocks||[]),page?propertySearchText(page,getState().pages):''].filter(Boolean).join('\n\n').slice(0,128000))}}).catch(cause=>{if(active.current)setError(aiErrorMessage(cause,t))}).finally(()=>{if(active.current)setLoadingContext(false)})
    return()=>{active.current=false;controller.current?.abort();void getAIBridge()?.aiCancel().catch(()=>{});if(previous?.isConnected)previous.focus()}
  },[pageId])
  useEffect(()=>{void refresh()},[provider,settings?.models[provider]])
  const generate=async()=>{
    if(!model||generating)return
    setGenerating(true);setError('');setNotice('');setAnswer('')
    const abort=new AbortController();controller.current=abort
    let partial=''
    try{
      const result=await runAI({feature:'assistant',operation,prompt,sources:includeContext&&context.trim()?[{pageId,title:page?.title,text:context}]:[],locale:locale==='en-US'?'en-US':'pt-BR',...(cloud?{}:{model})},{signal:abort.signal,onDelta:piece=>{partial+=piece;if(active.current)setAnswer(partial)}})
      if(active.current)setAnswer(result.text)
    }catch(cause){if(active.current)setError(aiErrorMessage(cause,t))}
    finally{if(active.current)setGenerating(false);controller.current=null}
  }
  const insert=async()=>{
    if(!answer.trim()||saving)return
    setSaving(true);setError('')
    try{
      if(!selectors.isLive(pageId)||selectors.page(pageId)?.locked)throw new Error(t('A página está bloqueada ou indisponível.', 'The page is locked or unavailable.'))
      // Treat model output as editable text: never execute generated HTML, scripts or actions.
      if(operation==='autofill'&&propertyId){
        if(!textProperties.some(property=>property.id===propertyId))throw new Error(t('A propriedade selecionada não está mais disponível.', 'The selected property is no longer available.'))
        actions.setProp(pageId,propertyId,answer)
        await actions.flushMeta()
      }else {
        if(insertion.current?.text!==answer) insertion.current={text:answer,blocks:answer.split(/\n\s*\n/).map(text=>({id:crypto.randomUUID(),type:'paragraph',content:[{type:'text',text,styles:{}}],children:[]}))}
        await actions.appendPageBlocks(pageId,insertion.current.blocks)
      }
      if(active.current){setNotice(operation==='autofill'&&propertyId?t('Propriedade atualizada com o resultado revisado.', 'Property updated with the reviewed result.'):t('Resultado adicionado ao final da página.', 'Result added to the end of the page.'));setAnswer('')}
    }catch(cause){if(active.current)setError(cause instanceof Error&&!/AI_/.test(cause.message)?cause.message:aiErrorMessage(cause,t))}
    finally{if(active.current)setSaving(false)}
  }
  return <div className="lai-overlay" onKeyDown={event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!saving)onClose()}
    if(event.key==='Tab'){const items=[...(box.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea')??[])];if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1)?.focus()}else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0]?.focus()}}
  }}><div className="lai-dialog" ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="lai-title">
    <header><Bot size={20}/><h2 id="lai-title">{t('Assistente de IA', 'AI assistant')}</h2><AIBadge provider={provider}/><button aria-label={t('Fechar assistente','Close assistant')} onClick={onClose} disabled={saving}><X size={18}/></button></header>
    <p>{cloud?t('Usa {name} (nuvem), configurado em Configurações → IA. Antes de enviar você vê exatamente o que sairá do Mac. Revise o resultado antes de adicioná-lo à página.','Uses {name} (cloud), set in Settings → AI. Before sending you see exactly what will leave your Mac. Review the result before adding it to the page.',{name:PROVIDER_LABEL[provider]}):t('Usa somente o Ollama deste dispositivo. Nenhum modelo é instalado automaticamente. Revise o resultado antes de adicioná-lo à página.', 'Uses only Ollama on this device. No model is installed automatically. Review the result before adding it to the page.')}</p>
    <div className="lai-model"><label>{cloud?t('Modelo','Model'):t('Modelo instalado','Installed model')}<Select value={model} disabled={generating||loading||cloud} onChange={event=>setModel(event.target.value)}><option value="">{t('Selecione um modelo','Select a model')}</option>{models.map(name=><option key={name}>{name}</option>)}</Select></label><button onClick={()=>void refresh()} disabled={loading||generating} aria-label={t('Atualizar modelos','Refresh models')}><RefreshCw size={16}/></button></div>
    <label>{t('Operação','Operation')}<Select value={operation} disabled={generating} onChange={event=>setOperation(event.target.value as Operation)}>{([['write',t('Escrever e melhorar texto','Write and improve text')],['summarize',t('Resumir página','Summarize page')],['translate',t('Traduzir texto','Translate text')],['ask',t('Perguntar sobre a página','Ask about page')],['autofill',t('Preencher propriedade de texto','Fill a text property')]] as const).map(([value,label])=><option key={value} value={value}>{label}</option>)}</Select></label>
    {operation==='autofill'&&<label>{t('Destino do resultado','Result destination')}<Select value={propertyId} onChange={event=>setPropertyId(event.target.value)}><option value="">{t('Adicionar ao corpo da página','Append to page body')}</option>{textProperties.map(property=><option key={property.id} value={property.id}>{property.name}</option>)}</Select><small>{t('O resultado só substitui o valor da propriedade quando você clicar em Aplicar à propriedade.','The result replaces the property value only when you click Apply to property.')}</small></label>}
    <label>{t('Instruções ou pergunta','Instructions or question')}<textarea value={prompt} maxLength={16000} onChange={event=>setPrompt(event.target.value)} placeholder={t('Ex.: traduza para inglês mantendo os termos técnicos.','E.g. translate into English and preserve technical terms.')}/></label>
    <label className="lai-check"><input type="checkbox" checked={includeContext} onChange={event=>setIncludeContext(event.target.checked)}/>{t('Incluir texto desta página como contexto','Include this page’s text as context')}</label>
    {includeContext&&<details><summary>{t('Revisar contexto (até 128 mil caracteres)','Review context (up to 128,000 characters)')} · {context.length.toLocaleString(locale)}</summary><textarea aria-label={t('Contexto enviado ao modelo','Context sent to the model')} value={context} maxLength={128000} onChange={event=>setContext(event.target.value)}/></details>}
    <button className="lai-primary" onClick={()=>void generate()} disabled={!model||loading||loadingContext||generating||saving}>{generating?(cloud?t('Gerando em {name}…','Generating on {name}…',{name:PROVIDER_LABEL[provider]}):t('Gerando no dispositivo…','Generating on device…')):t('Gerar prévia','Generate preview')}</button>
    {generating&&<button onClick={()=>controller.current?.abort()}><Square size={14}/>{t('Cancelar geração','Cancel generation')}</button>}
    {answer&&<section className="lai-result"><label>{t('Resultado editável','Editable result')}<textarea value={answer} readOnly={generating} onChange={event=>setAnswer(event.target.value)}/></label><div><button onClick={()=>void Promise.resolve().then(()=>{if(!navigator.clipboard)throw new Error(t('Área de transferência indisponível.','Clipboard unavailable.'));return navigator.clipboard.writeText(answer)}).then(()=>setNotice(t('Copiado.','Copied.'))).catch(cause=>setError(String(cause)))}><Copy size={16}/>{t('Copiar','Copy')}</button><button className="lai-primary" disabled={saving||locked||generating} onClick={()=>void insert()}><Plus size={16}/>{saving?t('Salvando…','Saving…'):operation==='autofill'&&propertyId?t('Aplicar à propriedade','Apply to property'):t('Adicionar à página','Add to page')}</button></div></section>}
    {notice&&<p role="status">{notice}</p>}{error&&<p className="lai-error" role="alert">{error}</p>}
  </div></div>
}
