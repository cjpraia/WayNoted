import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {JSDOM} from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import { shimUi } from './fixtures/ui-shim.mjs'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
const dom=new JSDOM('<!doctype html><body><div id="app"></div></body>',{url:'http://localhost'})
for(const name of ['window','document','navigator','HTMLElement'])Object.defineProperty(globalThis,name,{configurable:true,value:dom.window[name]})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const t=(_pt,en,vars)=>en.replace(/\{(\w+)\}/g,(_,key)=>String(vars?.[key]??''))
const api={securityInfo:async()=>({enabled:true}),localApiInfo:async()=>({enabled:false}),listActivity:async()=>[],listAutoBackups:async()=>[],webhookStatus:async()=>[],listDocumentConflicts:async()=>[]}
window.api=api
const mocks={t,useI18n:()=>({locale:'en-US',t}),api,actions:{flushMeta:async()=>{},setSettingsOpen:()=>{}},selectors:{isLive:()=>true,trash:()=>[]},useStore:()=>({settings:{locale:'en-US',theme:'system',userName:'',workspaceName:'Workspace',historyLimit:0},pages:{}})}
globalThis.__settingsLanguage=mocks
let source=await readFile(new URL('../src/components/modals/SettingsModal.tsx',import.meta.url),'utf8')
source=source.replace("import { actions, api, selectors, useStore } from '../../store'",'const {actions,api,selectors,useStore}=globalThis.__settingsLanguage').replace("import { t, useI18n } from '../../i18n'",'const {t,useI18n}=globalThis.__settingsLanguage').replace("import './SettingsModal.css'",'').replace("import { QuickCaptureSettings, takeRequestedSettingsSection } from '../../quick/QuickCaptureSettings'",'const QuickCaptureSettings=()=>null,takeRequestedSettingsSection=()=>null').replace("import { SecuritySettings } from '../../security/SecuritySettings'",'const SecuritySettings=()=>null').replace("import { CalendarSettingsSection } from '../calendar/CalendarSettingsSection'",'const CalendarSettingsSection=()=>null').replace("import { CalendarSettingsSection } from '../calendar/CalendarSettingsSection'",'const CalendarSettingsSection=()=>null')
const {SHORTCUTS,shortcutLabel}=await import('../src/shortcuts.ts')
globalThis.__settingsLanguage.ShortcutList=()=>React.createElement('table',null,React.createElement('tbody',null,SHORTCUTS.map(item=>React.createElement('tr',{key:item.id},React.createElement('td',null,shortcutLabel(item,'en-US'))))))
source=source.replace("import { ShortcutList } from '../shortcuts/ShortcutList'",'const {ShortcutList}=globalThis.__settingsLanguage')
source=source.replace(/^import \{ (\w+) \} from '\.\.\/productivity\/\w+'$/gm,'const $1=()=>null')
source=source.replace("import { DailyFlowSettings } from '../../daily/DailyFlowSettings'",'const DailyFlowSettings=()=>null')
source=source.replace("import { TypesSettings } from '../objecttypes/TypesSettings'",'const TypesSettings=()=>null')
source=source.replace("import { AISettingsSection } from '../ai/AISettings'",'const AISettingsSection=()=>null')
source=source.replace("import { Logo } from '../ui/Logo'",'const Logo=()=>null')
source=source.replace("import { HelpSettings } from './HelpSettings'",'const HelpSettings=()=>null')
source=source.replace("import { UpdateCheck } from './UpdateCheck'",'const UpdateCheck=()=>null')
source=source.replace("import { ThirdPartyNotices } from './ThirdPartyNotices'",'const ThirdPartyNotices=()=>null')
source=source.replace("import { BackupSettingsCard } from '../backup/BackupSettings'",'const BackupSettingsCard=()=>null').replace("import { MirrorSettingsCard } from '../mirror/MirrorSettings'",'const MirrorSettingsCard=()=>null').replace("import { AgentSettingsCards } from '../../agent/AgentSettings'",'const AgentSettingsCards=()=>null')
const out=await transformWithOxc(shimUi(source),'SettingsModal.tsx',{jsx:{runtime:'automatic'}})
const code=out.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g,(_m,name)=>`from ${JSON.stringify(import.meta.resolve(name))}`)
const {SettingsModal}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
test('every Settings section renders its labels in English, including native data controls',async()=>{
 const root=createRoot(document.getElementById('app'))
 await act(async()=>root.render(React.createElement(SettingsModal)))
 assert.equal(document.querySelector('[role="dialog"]').getAttribute('aria-label'),'Settings')
 for(const section of ['My account','Appearance','Data','Shortcuts','About']){
  const button=[...document.querySelectorAll('nav button')].find(button=>button.textContent.trim()===section);assert.ok(button,section)
  await act(async()=>button.click())
  assert.equal(document.querySelector('.st-h').textContent,section)
  if(section==='Data'){
   assert.match(document.body.textContent,/File protection/);assert.match(document.body.textContent,/Local API for integrations/)
   assert.match(document.body.textContent,/Version history/);assert.match(document.body.textContent,/Export backup/)
  }
  if(section==='Shortcuts')assert.match(document.querySelector('table').textContent,/New page.*New tab.*Reopen last closed tab.*Close tab/)
 }
 await act(async()=>root.unmount())
})

test('API token is copied through native IPC without renderer clipboard permission',async()=>{
 let copied=0, browserClipboardCalls=0
 api.localApiInfo=async()=>({enabled:true,url:'http://127.0.0.1:50132'})
 api.copyLocalApiToken=async()=>{copied++}
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{browserClipboardCalls++;throw new Error('Write permission denied')}}})
 const root=createRoot(document.getElementById('app'))
 await act(async()=>root.render(React.createElement(SettingsModal)))
 await act(async()=>[...document.querySelectorAll('nav button')].find(button=>button.textContent.trim()==='Data').click())
 const button=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Copy API token')
 assert.ok(button)
 await act(async()=>button.click())
 assert.equal(copied,1)
 assert.equal(browserClipboardCalls,0)
 assert.match(document.querySelector('[role="status"]').textContent,/Token copied/)
 assert.doesNotMatch(document.body.textContent,/api-token/i)
 await act(async()=>root.unmount())
})
