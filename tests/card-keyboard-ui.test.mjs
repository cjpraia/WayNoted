// Teclado nos cartões da lista e da galeria: setas, Enter abre, Espaço seleciona, F2 renomeia, duplo clique edita valor.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {JSDOM} from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
const dom=new JSDOM('<!doctype html><body><div id="app"></div></body>',{url:'http://localhost'})
for(const name of ['window','document','navigator','HTMLElement','Element','Node','getComputedStyle','requestAnimationFrame','cancelAnimationFrame'])Object.defineProperty(globalThis,name,{configurable:true,writable:true,value:name==='requestAnimationFrame'?fn=>setTimeout(()=>fn(Date.now()),0):name==='cancelAnimationFrame'?id=>clearTimeout(id):name==='getComputedStyle'?dom.window.getComputedStyle.bind(dom.window):dom.window[name]})
dom.window.Element.prototype.scrollIntoView=()=>{}
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {default:React,act}=await import('react')
const {createRoot}=await import('react-dom/client')
const t=(_pt,en,vars)=>en.replace(/\{(\w+)\}/g,(_,key)=>String(vars?.[key]??''))
const cardNav=await import('../src/components/database/views/shared/cardNav.ts')
const virt=await import('../src/components/database/virtual/useVirtualRows.ts')
const drag=await load2('../src/components/database/views/shared/useDrag.ts')
const sel=await import('../src/components/database/rowSelection.ts')
const props=[{id:'title',name:'Name',type:'title'},{id:'txt',name:'Note',type:'text'}]
const schema={properties:props,views:[]}
let data={},calls=[]
const reset=(n=7)=>{data={};calls=[];for(let i=0;i<n;i++)data[`r${i}`]={id:`r${i}`,parentId:'db',title:`Row ${i}`,text:'',props:{txt:`Note ${i}`}}}
let rerender=()=>{}
const store={updatePage:(id,patch)=>{calls.push(['page',id,patch]);data[id]={...data[id],...patch};rerender()},setProp:(id,p,v)=>{calls.push(['prop',id,p,v])},createRow:()=>'new',movePage:()=>{},duplicatePage:async()=>{},trashPage:()=>{}}
const mocks={t,actions:store,getState:()=>({pages:data}),selectors:{rows:()=>Object.values(data),database:()=>schema,page:id=>data[id]},
 getValue:(row,prop)=>prop.type==='title'?row.title:row.props?.[prop.id]??null,isEmptyValue:v=>v==null||v==='',defaultsForNewRow:()=>({}),
 PropDisplay:({value})=>React.createElement('span',null,String(value??'')),PropertyEditor:function Ed(p){return React.createElement('div',{'data-editor':p.property.id})},
 isComputedProperty:()=>false,MenuItem:()=>null,MenuSeparator:()=>null,Popover:()=>null,PageIcon:()=>null,matchingRowColor:()=>undefined,
 ...cardNav,...virt,...drag}
globalThis.__cardKb=mocks
async function load(file){
 let source=await readFile(new URL(file,import.meta.url),'utf8')
 source=source.replace(/import\s+(\{[\s\S]*?\})\s+from\s+'([^']+)'/g,(match,bindings,module)=>{
  if(module==='react'||module==='lucide-react')return match
  return `const ${bindings.replace(/\btype\s+\w+\s*,?/g,'')}=globalThis.__cardKb`
 }).replace(/^import type .*$/gm,'').replace(/^import '[^']+\.css'$/gm,'')
 const out=await transformWithOxc(source,file,{jsx:{runtime:'automatic'}})
 return import(`data:text/javascript;base64,${Buffer.from(out.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g,(_m,name)=>`from ${JSON.stringify(import.meta.resolve(name))}`)).toString('base64')}`)
}
async function load2(file){return load(file)}
Object.assign(mocks,await load('../src/components/database/views/shared/rows.tsx'))
const {ListView}=await load('../src/components/database/views/ListView.tsx')
const {GalleryView}=await load('../src/components/database/views/GalleryView.tsx')
const root=createRoot(document.getElementById('app'))
let selection
function Harness({View,readOnly}){
 const [order]=React.useState(()=>Object.keys(data))
 selection=sel.useRowSelection(order)
 return React.createElement(View,{db:{id:'db'},schema,view:{id:'v',type:'list',filters:[],sorts:[],hidden:[],widths:{}},rows:Object.values(data),visibleProps:props,readOnly:!!readOnly,onOpenRow:id=>calls.push(['open',id]),selection})
}
async function mount(View,readOnly){rerender=()=>root.render(React.createElement(Harness,{View,readOnly}));await act(async()=>rerender())}
const card=id=>document.querySelector(`[data-row-id="${id}"]`)
const press=async(id,key,init={})=>{const el=card(id);el.focus();await act(async()=>{el.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...init}))});await act(async()=>{await new Promise(r=>setTimeout(r,10))})}
const focusedId=()=>document.activeElement?.dataset?.rowId??null
test.after(async()=>{await act(async()=>root.unmount())})

test('lista: setas movem o foco entre as linhas (roving tabindex), Enter abre, Espaço seleciona',async()=>{
 reset();await mount(ListView)
 assert.equal(document.querySelectorAll('[data-row-id][tabindex="0"]').length,1)
 assert.equal(card('r0').getAttribute('tabindex'),'0')
 await press('r0','ArrowDown');assert.equal(focusedId(),'r1')
 assert.equal(card('r1').getAttribute('tabindex'),'0');assert.equal(card('r0').getAttribute('tabindex'),'-1')
 await press('r1','ArrowRight');assert.equal(focusedId(),'r1','lista não anda na horizontal')
 await press('r1','End');assert.equal(focusedId(),'r6')
 await press('r6','ArrowDown');assert.equal(focusedId(),'r6')
 await press('r6','Enter');assert.deepEqual(calls.at(-1),['open','r6'])
 await press('r6',' ');assert.ok(selection.has('r6'))
 await press('r6',' ');assert.ok(!selection.has('r6'))
})

test('F2 renomeia no cartão e o foco volta a ele; Esc/Enter confirmam',async()=>{
 reset();await mount(ListView)
 await press('r2','F2')
 const input=document.querySelector('input.vw-inline-input')
 assert.ok(input!==null,'campo de título aberto')
 assert.ok(document.activeElement===input)
 await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,'Novo nome');input.dispatchEvent(new dom.window.Event('input',{bubbles:true}))})
 await act(async()=>{input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,10))})
 assert.deepEqual(calls.at(-1),['page','r2',{title:'Novo nome'}])
 assert.equal(focusedId(),'r2')
})

test('somente leitura: sem F2, sem ✎, mas setas e Enter funcionam',async()=>{
 reset();await mount(ListView,true)
 assert.equal(document.querySelectorAll('.vw-rename').length,0)
 await press('r0','F2');assert.ok(document.querySelector('input.vw-inline-input')===null)
 await press('r0','ArrowDown');assert.equal(focusedId(),'r1')
})

test('duplo clique no valor abre o editor inline; o clique simples abre a página só depois do atraso',async()=>{
 reset();await mount(ListView)
 const value=document.querySelector('[data-row-id="r1"] [data-prop-id="txt"]')
 await act(async()=>{value.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}))})
 assert.equal(calls.filter(c=>c[0]==='open').length,0,'ainda não abriu')
 await act(async()=>{value.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true,detail:2}));value.dispatchEvent(new dom.window.MouseEvent('dblclick',{bubbles:true}))})
 await act(async()=>{await new Promise(r=>setTimeout(r,300))})
 assert.equal(calls.filter(c=>c[0]==='open').length,0,'o duplo clique cancelou a abertura')
 assert.ok(document.querySelector('[data-editor="txt"]')!==null)
 await act(async()=>{value.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}))})
 await act(async()=>{await new Promise(r=>setTimeout(r,300))})
 assert.deepEqual(calls.at(-1),['open','r1'])
})

test('galeria: setas usam o número de colunas da grade',async()=>{
 reset(8);await mount(GalleryView)
 const grid=document.querySelector('.gl')
 dom.window.getComputedStyle=()=>({gridTemplateColumns:'100px 100px 100px',overflowY:'visible',overflowX:'visible'})
 globalThis.getComputedStyle=dom.window.getComputedStyle
 await press('r0','ArrowDown');assert.equal(focusedId(),'r3')
 await press('r3','ArrowRight');assert.equal(focusedId(),'r4')
 await press('r4','ArrowUp');assert.equal(focusedId(),'r1')
 assert.ok(grid!==null)
})
