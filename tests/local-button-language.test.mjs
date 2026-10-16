import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {JSDOM} from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import {Select} from './fixtures/ui-shim.mjs'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {decodeLocalButtonActions,LocalButtonValidationError} from '../src/components/database/localButtonActions.ts'
import {validActions} from '../src/components/database/engines.ts'
import {translate} from '../src/localization.ts'
const cases=[
 ['configurationTooLong',' '.repeat(20001),'Configuração de botão longa demais.','Button configuration is too long.'],
 ['invalidConfiguration','{','Configuração de botão inválida.','Invalid button configuration.'],
 ['invalidConfiguration','{}','Configuração de botão inválida.','Invalid button configuration.'],
 ['tooManyActions',JSON.stringify(Array.from({length:17},()=>({kind:'openPage',targetPageId:'p'}))),'Botão aceita até 16 ações locais.','A button supports up to 16 local actions.'],
 ['invalidAction','[null]','Ação de botão inválida.','Invalid button action.'],
 ['invalidAction','[{"kind":"executeScript"}]','Ação de botão inválida.','Invalid button action.'],
 ['incompleteAction','[{"kind":"setProperty","rowId":"r","propertyId":"","value":true}]','Complete o destino e a propriedade de cada ação antes de executar.','Complete each action’s target and property before running.'],
]
test('button decoder returns structured, specific validation messages in both languages',()=>{
 for(const [code,input,pt,en] of cases)for(const [locale,message] of [['pt-BR',pt],['en-US',en]])assert.throws(()=>decodeLocalButtonActions(input,locale),error=>error instanceof LocalButtonValidationError&&error.code===code&&error.message===message)
 const incomplete='[{"kind":"setProperty","rowId":"r","propertyId":"","value":true}]'
 assert.equal(decodeLocalButtonActions(incomplete,'en-US',{allowIncomplete:true})[0].propertyId,'')
 assert.throws(()=>decodeLocalButtonActions('[{"kind":"executeScript"}]','en-US',{allowIncomplete:true}),/Invalid button action/)
})
const dom=new JSDOM('<!doctype html><body><div id="app"></div></body>',{url:'http://localhost'})
for(const name of ['window','document','navigator','HTMLElement'])Object.defineProperty(globalThis,name,{configurable:true,value:dom.window[name]})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
let locale='en-US',executed=[]
const pages={owner:{id:'owner',title:'Owner'},db:{id:'db',title:'Database',database:{properties:[{id:'title',name:'Name',type:'title'},{id:'done',name:'Done',type:'checkbox'}],views:[]}},row:{id:'row',title:'Row',parentId:'db'}}
const mocks={decodeLocalButtonActions,validActions,useI18n:()=>({locale,t:(pt,en,vars)=>translate(locale,pt,en,vars)}),useStore:()=>({pages}),selectors:{isLive:id=>!!pages[id],page:id=>pages[id],database:id=>pages[id]?.database},actions:{flushMeta:async()=>{},runDatabaseActions:async(id,steps)=>executed.push({id,steps})}}
mocks.Select=Select
globalThis.__localButtonLanguage=mocks
const source=await readFile(new URL('../src/components/page/schema.tsx',import.meta.url),'utf8')
const start=source.indexOf('function LocalButton('),end=source.indexOf('\nexport const LocalButtonBlock',start)
assert.ok(start>=0&&end>start)
// Compile the production component verbatim, isolated from unrelated block specs.
const component="import {useRef,useState} from 'react';\nconst {decodeLocalButtonActions,validActions,useI18n,useStore,selectors,actions,Select}=globalThis.__localButtonLanguage;\nexport "+source.slice(start,end)
const out=await transformWithOxc(component,'LocalButton.tsx',{jsx:{runtime:'automatic'}})
const code=out.code.replace(/from ["'](react(?:\/jsx-runtime)?)["']/g,(_m,name)=>`from ${JSON.stringify(import.meta.resolve(name))}`)
const {LocalButton}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
test('real button UI retains incomplete action controls, blocks execution and displays localized errors',async()=>{
 const root=createRoot(document.getElementById('app'))
 try{
  const tooMany=cases.find(item=>item[0]==='tooManyActions')[1]
  for(const language of ['en-US','pt-BR']){
   locale=language
   await act(async()=>root.render(React.createElement(LocalButton,{blockId:'b',label:'',targetPageId:'',actionsJson:tooMany,editor:{isEditable:true}})))
   assert.equal(document.querySelector('[role="alert"]').textContent,language==='en-US'?cases[3][3]:cases[3][2])
   assert.equal(document.querySelector('.pg-local-button > button').disabled,true)
  }
 }finally{await act(async()=>root.unmount())}
})
test('set-property action remains editable until configured, then executes with correct values in either locale',async()=>{
 for(const language of ['pt-BR','en-US']){
  locale=language;executed=[]
  const root=createRoot(document.getElementById('app'))
  function Harness(){
   const [json,setJson]=React.useState('[{"kind":"openPage","targetPageId":"owner"}]')
   return React.createElement('div',{className:'pg-root','data-page-id':'owner'},React.createElement(LocalButton,{blockId:'b',label:'',targetPageId:'',actionsJson:json,editor:{isEditable:true,updateBlock:(_id,value)=>setJson(value.props.actionsJson)}}))
  }
  const label=(pt,en)=>translate(locale,pt,en)
  const select=async(name,value)=>{const element=document.querySelector(`select[aria-label="${name}"]`);assert.ok(element,name);await act(async()=>{element.value=value;element.dispatchEvent(new dom.window.Event('change',{bubbles:true}))})}
  try{
   await act(async()=>root.render(React.createElement(Harness)))
   await select(label('Ação 1','Action 1'),'setProperty')
   assert.ok(document.querySelector(`select[aria-label="${label('Propriedade','Property')}"]`))
   assert.equal(document.querySelector('.pg-local-button > button').disabled,true)
   assert.match(document.querySelector('[role="alert"]').textContent,language==='pt-BR'?/Complete o destino/:/Complete each action/)
   await act(async()=>document.querySelector('.pg-local-button > button').click());assert.equal(executed.length,0)
   await select(label('Propriedade','Property'),'done');await select(label('Valor','Value'),'true')
   assert.equal(document.querySelector('[role="alert"]'),null)
   assert.equal(document.querySelector('.pg-local-button > button').disabled,false)
   await act(async()=>document.querySelector('.pg-local-button > button').click())
   assert.deepEqual(executed,[{id:'row',steps:[{kind:'setProperty',propertyId:'done',value:true}]}])
  }finally{await act(async()=>root.unmount())}
 }
})
