// Teclado da tabela (célula ativa, ARIA, edição, colar TSV, grupos, bancos bloqueados). Sem nós do DOM nos asserts.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {JSDOM} from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
const dom=new JSDOM('<!doctype html><body><div id="app"></div></body>',{url:'http://localhost'})
for(const name of ['window','document','navigator','HTMLElement','Element','Node','getComputedStyle','requestAnimationFrame','cancelAnimationFrame'])Object.defineProperty(globalThis,name,{configurable:true,writable:true,value:name==='requestAnimationFrame'?fn=>setTimeout(()=>fn(Date.now()),0):name==='cancelAnimationFrame'?id=>clearTimeout(id):name==='getComputedStyle'?dom.window.getComputedStyle.bind(dom.window):dom.window[name]})
dom.window.Element.prototype.scrollIntoView=()=>{}
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const t=(_pt,en,vars)=>en.replace(/\{(\w+)\}/g,(_,key)=>String(vars?.[key]??''))
const nav=await import('../src/components/database/tableNav.ts')
const clip=await import('../src/components/database/tableClipboard.ts')
const sel=await import('../src/components/database/rowSelection.ts')
const virt=await import('../src/components/database/virtual/useVirtualRows.ts')
const derived=await import('../src/components/database/derived.ts')

const props=[{id:'title',name:'Name',type:'title'},{id:'txt',name:'Note',type:'text'},{id:'num',name:'Value',type:'number'},{id:'chk',name:'Done',type:'checkbox'},{id:'sel',name:'State',type:'select',options:[{id:'a',name:'Open',color:'blue'}]}]
const schema={properties:props,views:[]}
let data={},calls=[],undoLabels=[],rerender=()=>{}
const reset=(n=4)=>{data={};calls=[];undoLabels=[];for(let i=0;i<n;i++)data[`r${i}`]={id:`r${i}`,parentId:'db',title:`Row ${i}`,props:{txt:`Note ${i}`,num:i,chk:false}}}
const store={
 setProp:(id,prop,value)=>{calls.push(['prop',id,prop,value]);data[id]={...data[id],props:{...data[id].props,[prop]:value}};rerender()},
 updatePage:(id,patch)=>{calls.push(['page',id,patch]);data[id]={...data[id],...patch};rerender()},
 trackRowsUndo:(label,ids,fn)=>{undoLabels.push([label,ids.length]);return fn()},
 createRow:()=>'new',createPage:()=>'new',movePage:()=>{},duplicatePage:async()=>{},trashPage:()=>{},updateView:()=>{},
}
const mocks={t,getLocale:()=>'en-US',actions:store,getState:()=>({pages:data}),selectors:{rows:()=>Object.values(data)},
 defaultsForNewRow:()=>({}),getValue:(row,prop)=>prop.type==='title'?row.title:row.props?.[prop.id]??null,isEmptyValue:v=>v===null||v===''||(Array.isArray(v)&&!v.length),
 PropDisplay:({value})=>React.createElement('span',null,value==null?'':String(value)),PropTypeIcon:()=>null,
 PropertyEditor:function MockEditor(p){React.useEffect(()=>{const h=e=>{if(e.key==='Escape')p.onClose('escape')};document.addEventListener('keydown',h);return()=>document.removeEventListener('keydown',h)},[]);return React.createElement('div',{'data-editor':p.property.id,'data-seed':p.seed??''})},
 openUrl:()=>{},NewPropertyMenu:()=>null,PropertyMenu:()=>null,DbPopover:()=>null,Menu:()=>null,MenuItem:()=>null,MenuSep:()=>null,
 addProperty:()=>'p',moveProperty:()=>{},isComputedProperty:derived.isComputedProperty,BulkBar:()=>null,TableFooterCalc:()=>null,PageIcon:()=>null,
 matchingRowColor:()=>undefined,CellComments:()=>null,...sel,...virt,...nav,...clip}
globalThis.__tableKb=mocks
async function load(file){
 let source=await readFile(new URL(file,import.meta.url),'utf8')
 source=source.replace(/import\s+(\{[\s\S]*?\})\s+from\s+'([^']+)'/g,(match,bindings,module)=>{
  if(module==='react'||module==='lucide-react')return match
  return `const ${bindings.replace(/\btype\s+\w+\s*,?/g,'')}=globalThis.__tableKb`
 }).replace(/^import type .*$/gm,'').replace(/^import '[^']+\.css'$/gm,'')
 const out=await transformWithOxc(source,file,{jsx:{runtime:'automatic'}})
 return import(`data:text/javascript;base64,${Buffer.from(out.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g,(_m,name)=>`from ${JSON.stringify(import.meta.resolve(name))}`)).toString('base64')}`)
}
const {TableView}=await load('../src/components/database/TableView.tsx')

const root=createRoot(document.getElementById('app'))
function Harness({groups,readOnly,count}){
 const all=Object.values(data)
 const parts=groups?[all.slice(0,count),all.slice(count)]:[all]
 return React.createElement('div',{className:'dbv-body'},parts.map((rows,i)=>React.createElement(TableView,{key:i,db:{id:'db',title:'DB'},schema,view:{id:'v',type:'table',filters:[],sorts:[],hidden:[],widths:{}},rows,visibleProps:props,readOnly:!!readOnly,schemaLocked:false,onOpenRow:id=>calls.push(['open',id])})))
}
async function mount(options={}){
 rerender=()=>root.render(React.createElement(Harness,options))
 await act(async()=>rerender())
}
const grids=()=>[...document.querySelectorAll('[role="grid"]')]
const cellId=(row,prop)=>document.querySelector(`[data-cell="${row}:${prop}"]`).id
const activeId=(g=0)=>grids()[g].getAttribute('aria-activedescendant')
const press=async(key,init={},g=0)=>{const grid=grids()[g];grid.focus();await act(async()=>{grid.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...init}))})}
const click=async(row,prop)=>{await act(async()=>document.querySelector(`[data-cell="${row}:${prop}"]`).dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})))}
const paste=async text=>{const grid=grids()[0];grid.focus();await act(async()=>{const ev=new dom.window.Event('paste',{bubbles:true,cancelable:true});ev.clipboardData={getData:()=>text};grid.dispatchEvent(ev)})}
const closeEditor=async()=>{await act(async()=>{document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await new Promise(r=>setTimeout(r,10))})}
const editor=()=>document.querySelector('[data-editor]')
test.after(async()=>{await act(async()=>root.unmount())})

test('grade ARIA, clique ativa a célula e as setas movem o foco virtual',async()=>{
 reset();await mount()
 assert.equal(grids()[0].getAttribute('aria-rowcount'),'5')
 assert.equal(grids()[0].getAttribute('aria-colcount'),'5')
 assert.ok(activeId()===null,'sem célula ativa no início')
 await click('r1','txt')
 assert.equal(activeId(),cellId('r1','txt'))
 assert.equal(document.querySelectorAll('[aria-selected="true"][role="gridcell"]').length,1)
 await closeEditor()
 assert.ok(document.activeElement===grids()[0],'Esc devolve o foco à grade')
 assert.equal(activeId(),cellId('r1','txt'),'a célula continua ativa')
 await press('ArrowDown');assert.equal(activeId(),cellId('r2','txt'))
 await press('ArrowRight');assert.equal(activeId(),cellId('r2','num'))
 await press('ArrowUp');await press('ArrowUp');assert.equal(activeId(),cellId('r0','num'))
 await press('ArrowUp');assert.equal(activeId(),cellId('r0','num'),'não passa da primeira linha')
 await press('End');assert.equal(activeId(),cellId('r0','sel'))
 await press('Home');assert.equal(activeId(),cellId('r0','title'))
 await press('ArrowDown',{metaKey:true});assert.equal(activeId(),cellId('r3','title'))
 await press('ArrowUp',{metaKey:true});assert.equal(activeId(),cellId('r0','title'))
 await press('Tab');await press('Tab');assert.equal(activeId(),cellId('r0','num'))
 await press('Tab',{shiftKey:true});assert.equal(activeId(),cellId('r0','txt'))
})

test('Enter/F2 abrem o editor; digitar substitui; Backspace limpa em um passo; checkbox alterna',async()=>{
 reset();await mount()
 await click('r1','txt');assert.ok(editor()!==null,'clique abre o editor');await closeEditor()
 await press('ArrowDown')
 await press('Enter');assert.equal(editor().dataset.editor,'txt');await closeEditor()
 await press('ArrowRight')
 await press('F2');assert.equal(editor().dataset.editor,'num');await closeEditor()
 await press('ArrowLeft');await press('9');assert.equal(editor().dataset.editor,'txt');assert.equal(editor().dataset.seed,'9');await closeEditor()
 await press('Backspace')
 assert.deepEqual(calls.at(-1),['prop','r2','txt',null])
 assert.deepEqual(undoLabels.at(-1),['Clear cell',1])
 await press('ArrowRight');await press('ArrowRight')
 await press(' ');assert.deepEqual(calls.at(-1),['prop','r2','chk',true])
 await press('Enter');assert.deepEqual(calls.at(-1),['prop','r2','chk',false])
 await press('ArrowRight');await press('x');assert.ok(editor()===null,'select não aceita digitação')
 await press('Enter',{metaKey:true});assert.deepEqual(calls.at(-1),['open','r2'])
})

test('teclas dentro de campos e do gutter não são capturadas',async()=>{
 reset();await mount();await click('r0','txt');await closeEditor()
 const before=activeId()
 const box=document.querySelector('.tb-select')
 await act(async()=>box.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true})))
 assert.equal(activeId(),before)
 assert.ok(!editor())
})

test('colar TSV preenche a partir da célula ativa em um passo de desfazer, ignorando o que não converte',async()=>{
 reset(4);await mount();await click('r1','txt');await closeEditor()
 calls.length=0;undoLabels.length=0
 await paste('A\t7\nB\tzzz\nC\t9\nD\t1\nE\t2')
 // 3 linhas restantes (r1..r3) × 2 colunas; "zzz" não é número e fica de fora; "D"/"E" excedem a tabela.
 const set=calls.filter(c=>c[0]==='prop').map(c=>c.slice(1).join('|'))
 assert.deepEqual(set,['r1|txt|A','r1|num|7','r2|txt|B','r3|txt|C','r3|num|9'])
 assert.equal(undoLabels.length,1)
 assert.deepEqual(undoLabels[0],['Paste into cells',3])
 assert.match(document.querySelector('.tb-note').textContent,/5 cells pasted/)
})

test('banco bloqueado/somente leitura: setas movem, edição e colagem não',async()=>{
 reset();await mount({readOnly:true});await click('r0','txt')
 assert.ok(editor()===null)
 await press('ArrowDown');assert.equal(activeId(),cellId('r1','txt'))
 await press('Enter');await press('Backspace');await press('a');await paste('x')
 assert.equal(calls.filter(c=>c[0]==='prop'||c[0]==='page').length,0)
 assert.ok(editor()===null)
 await press('Enter',{metaKey:true});assert.deepEqual(calls.at(-1),['open','r1'])
})

test('grupos: as setas atravessam de uma tabela para a próxima e voltam',async()=>{
 reset(4);await mount({groups:true,count:2})
 assert.equal(grids().length,2)
 await click('r1','num');await closeEditor()
 await press('ArrowDown')
 assert.ok(activeId(0)===null,'a primeira tabela solta a célula')
 assert.equal(activeId(1),cellId('r2','num'))
 await press('ArrowUp',{},1)
 assert.equal(activeId(0),cellId('r1','num'))
 await press('ArrowDown',{metaKey:true})
 assert.equal(activeId(1),cellId('r3','num'))
 await press('ArrowUp',{metaKey:true},1)
 assert.equal(activeId(0),cellId('r0','num'))
})

test('Shift+setas estendem a seleção de linhas',async()=>{
 reset(5);await mount();await click('r1','txt');await closeEditor()
 await press('ArrowDown',{shiftKey:true});await press('ArrowDown',{shiftKey:true})
 const rows=[...document.querySelectorAll('[role="row"][aria-selected="true"]')].map(el=>el.dataset.vkey)
 assert.deepEqual(rows,['r1','r2','r3'])
 await press('ArrowUp',{shiftKey:true})
 assert.equal(document.querySelectorAll('[role="row"][aria-selected="true"]').length,2)
})
