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
const state={notifications:{},pages:{page:{id:'page',title:'Page'}},route:{type:'page',id:'page'}}
let failing=true,creates=0
const mocks={actions:{setInboxOpen(){},scheduleReminder(pageId,dueAt,title,body,repeat){const id=String(++creates);state.notifications[id]={id,pageId,dueAt,title,body,repeat,readAt:null,firedAt:null};return id},updateNotification(id,patch){Object.assign(state.notifications[id],patch)},flushMeta:async()=>{if(failing)throw new Error('disk unavailable')},reportSaveError(){},removeNotification(id){delete state.notifications[id]}},selectors:{isLive:id=>id==='page'},useStore:()=>state,useI18n:()=>({locale:'en-US',t:(_pt,en)=>en})}
globalThis.__inboxTest=mocks
let source=await readFile(new URL('../src/components/modals/InboxModal.tsx',import.meta.url),'utf8')
source=source.replace("import { actions, selectors, useStore } from '../../store'",'const {actions,selectors,useStore}=globalThis.__inboxTest').replace("import { useI18n } from '../../i18n'",'const {useI18n}=globalThis.__inboxTest').replace("import { PageIcon } from '../page/PageIcon'",'const PageIcon=()=>null').replace("import './InboxModal.css'",'').replace("import { Illustration } from '../ui/illustrations/Illustration'",'const Illustration=()=>null')
const compiled=await transformWithOxc(shimUi(source),'InboxModal.tsx',{jsx:{runtime:'automatic'}})
const code=compiled.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g,(_m,name)=>`from ${JSON.stringify(import.meta.resolve(name))}`)
const {InboxModal}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const click=async label=>{const el=[...document.querySelectorAll('button')].find(b=>b.textContent===label);assert.ok(el,label);await act(async()=>{el.click();await new Promise(r=>setTimeout(r,5))})}
test('reminder save failure is visible and retry persists the same reminder without duplication',async()=>{
 const root=createRoot(document.getElementById('app'));await act(async()=>root.render(React.createElement(InboxModal)))
 await click('New reminder');await click('Save reminder');assert.equal(creates,1);assert.match(document.querySelector('[role="alert"]').textContent,/disk unavailable/)
 failing=false;await click('Save reminder');assert.equal(creates,1);assert.equal(Object.keys(state.notifications).length,1);assert.equal(document.querySelector('form'),null)
 assert.match(document.querySelector('.inbox-item').textContent,/Page/)
 await act(async()=>root.unmount())
})
