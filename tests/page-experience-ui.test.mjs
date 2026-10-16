import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { isEmptyPageDocument } from '../src/components/page/emptyPage.ts'
import { clampPeekWidth } from '../src/components/peekSizing.ts'
import { cloneDocument, remapReferences } from '../src/workspace.ts'
import { pageBlockReferences } from '../src/page-block-ownership.ts'
const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost' })
for (const name of ['window','document','navigator','HTMLElement','getComputedStyle']) Object.defineProperty(globalThis,name,{configurable:true,value:dom.window[name]})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
dom.window.HTMLElement.prototype.attachEvent=()=>{};dom.window.HTMLElement.prototype.detachEvent=()=>{}
Object.defineProperty(window,'innerWidth',{value:1800,configurable:true})
globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);globalThis.cancelAnimationFrame=clearTimeout
const t=(_pt,en)=>en
let pages, saved, editor, state, updates, failure, closes, opened, listeners, metaFailure
const mocks={
 t,DailyNoteNav:()=>null,useI18n:()=>({locale:'en-US',t}),isEmptyPageDocument,clampPeekWidth,cloneDocument,remapReferences,pageBlockReferences,
 isDocDirty:()=>false,loadDraft:async()=>null,deleteDraft:async()=>{},blocksToText:()=>'',
 selectors:{page:id=>pages[id],parentDatabase:id=>pages[pages[id]?.parentId]?.database ? pages[pages[id].parentId] : undefined,backlinks:()=>[{id:'parent',title:'Parent'}],children:parentId=>Object.values(pages).filter(p=>p.parentId===parentId),isLive:id=>Boolean(pages[id]&&!pages[id].deletedAt)},
 useStore:()=>state,getState:()=>state,api:{loadDoc:async()=>saved},
 actions:{updatePage:(id,patch)=>{updates.push([id,patch]);Object.assign(pages[id],patch)},flushMeta:async()=>{if(metaFailure)throw metaFailure},reportSaveError:error=>{failure=error},duplicatePage:async()=>{throw Error('Unexpected page duplication')},createDatabase:(parentId,type,init)=>{const id='created-db';pages[id]={id,parentId,database:{views:[{type}]},...init};return id},closePeek:()=>{closes++;state.peekPageId=null},openPage:id=>opened.push(id),openPeek:(id,mode)=>{state.peekPageId=id;state.peekMode=mode},setPeekWidth:width=>{state.peekWidth=width},toggleFavorite:()=>{}},
 flushDoc:async()=>{if(failure)throw failure},assertCanClose:()=>{},PageIcon:()=>null,CoverPicker:()=>null,EmojiPicker:()=>null,RowProperties:()=>null,RowLayoutSettings:()=>null,PageComments:()=>React.createElement('div',null,'Comments'),PageMenu:()=>null,LocalAIModal:()=>React.createElement('div',null,'Local AI'),DatabaseView:()=>null,UnlinkedMentions:()=>null,ChildPages:()=>null,EditorBoundary:({children})=>children,
 PageEditor:({onReady})=>{React.useEffect(()=>{onReady(editor)},[]);return React.createElement('div',{'data-editor':'true'})},availableTemplates:()=>[{id:'tasks',title:'Tasks',icon:null,description:'Check list',blocks:[{id:'old-template',type:'checkListItem',content:[{type:'text',text:'Todo',styles:{bold:true}}]}]}] }
Object.assign(mocks,{objectTypes:()=>[],typesAsTemplates:()=>[],sidebarTypes:()=>[],applyTypeFlow:async()=>0,TypeHeader:()=>null,TypeFields:()=>null,TypeTagSuggestion:()=>null,registerTypeEditor:()=>()=>{},insertTextInPageEditor:()=>false,VariablePicker:()=>null,hasPendingCursor:()=>false,applyPendingCursor:()=>false,placeCursor:()=>false,prepareTemplate:async blocks=>({blocks,unknown:[],cursor:null,answers:{}})})
mocks.shortcutHint=()=>''
globalThis.__experience=mocks
// Painel de configurações e seleção de linhas do DatabaseView (docs/DEVELOPMENT.md).
Object.assign(mocks,await import('../src/components/database/rowSelection.ts'),{viewBodyClasses:(await import('../src/components/database/settings/model.ts')).viewBodyClasses,Icon:()=>null,BulkBar:()=>null,ViewSettingsPanel:()=>null,ViewTabMenu:()=>null,
 // Visualização vinculada (docs/USAGE.md): estes bancos não são vinculados.
 linkedSourceOf:()=>undefined,AddViewPanel:()=>null,LinkedBadge:()=>null,LinkedTitle:()=>null,MissingSource:()=>null,linkedTipSeen:()=>true,markLinkedTipSeen(){},LINKED_SCHEMA_NOTICE_KEY:'k'})
async function load(file){
 let source=await readFile(new URL(file,import.meta.url),'utf8')
 source=source.replace(/import\s+(\{[\s\S]*?\})\s+from\s+'([^']+)'/g,(match,bindings,module)=>{
  if(module==='react'||module==='lucide-react')return match
  return `const ${bindings.replace(/\btype\s+\w+\s*,?/g,'')}=globalThis.__experience`
 }).replace(/^import type .*$/gm,'').replace(/^import '[^']+\.css'$/gm,'')
 const out=await transformWithOxc(source,file,{jsx:{runtime:'automatic'}})
 return import(`data:text/javascript;base64,${Buffer.from(out.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g,(_m,name)=>`from ${JSON.stringify(import.meta.resolve(name))}`)).toString('base64')}`)
}
const {PageView}=await load('../src/components/page/PageView.tsx')
mocks.PageView=PageView
const {PagePeek}=await load('../src/components/PagePeek.tsx')
const empty=[{id:'empty',type:'paragraph',content:[],children:[]}]
function reset(){
 pages={page:{id:'page',parentId:null,title:'',locked:false,font:'default'},parent:{id:'parent',parentId:null,title:'Parent'}}
 saved=structuredClone(empty);state={docRevision:0,route:{type:'page',id:'parent'},peekPageId:'page',peekMode:'side',peekWidth:720,peekRowIds:null};updates=[];failure=null;metaFailure=null;closes=0;opened=[];listeners=new Set()
 editor={document:structuredClone(empty),onChange:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},getBlock:id=>editor.document.find(b=>b.id===id),focus:()=>{},isFocused:()=>false,setTextCursorPosition:()=>{},insertBlocks:(blocks,ref,side)=>{const result=cloneDocument(blocks,{});const at=editor.document.indexOf(ref)+(side==='after'?1:0);editor.document.splice(at,0,...result);listeners.forEach(fn=>fn());return result},replaceBlocks:(_old,blocks)=>{editor.document=blocks;listeners.forEach(fn=>fn())}}
}
const click=async label=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label||b.getAttribute('aria-label')===label);assert.ok(button,label);await act(async()=>button.click())}
const key=async(el,value,opts={})=>act(async()=>el.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true,...opts})))

test('blank document detection preserves structural and non-text inline blocks',()=>{
 assert.equal(isEmptyPageDocument(null),true);assert.equal(isEmptyPageDocument(empty),true)
 for(const block of [{type:'paragraph',content:[],props:{backgroundColor:'yellow'}},{type:'image',props:{url:'data:image/png;base64,a'}},{type:'page',props:{pageId:'db'}},{type:'paragraph',children:[{type:'paragraph'}]},{type:'paragraph',content:[{type:'pageMention',props:{pageId:'x'}}]}])assert.equal(isEmptyPageDocument([block]),false)
})
test('blank page shows working starters, retains empty title, hides backlinks and starts on Enter',async()=>{
 reset();const root=createRoot(document.getElementById('app'));await act(async()=>root.render(React.createElement(PageView,{pageId:'page',theme:'light'})))
 assert.ok(document.querySelector('.pg-starter'));assert.equal(document.querySelector('.pg-backlinks'),null);assert.equal(document.querySelector('textarea').value,'');assert.equal(document.querySelector('textarea').placeholder,'New page');assert.ok(document.querySelector('.pg-body').hidden)
 await click('Templates');await click('TasksCheck list');assert.equal(editor.document[0].type,'checkListItem');assert.notEqual(editor.document[0].id,'old-template');assert.equal(editor.document[0].content[0].styles.bold,true);assert.equal(pages.page.title,'');assert.equal(document.querySelector('.pg-starter'),null)
 await act(async()=>{editor.document=structuredClone(empty);listeners.forEach(fn=>fn())});assert.ok(document.querySelector('.pg-starter'))
 await key(document.querySelector('textarea'),'Enter');assert.equal(document.querySelector('.pg-body').hidden,false);assert.equal(document.querySelector('.pg-starter'),null)
 await act(async()=>root.unmount());assert.equal(listeners.size,0)
})
test('starter database and form remain owned by the current page and failed saves retain the inserted body',async()=>{
 for(const type of ['table','form']){
  reset();failure=Error('Disk full');const root=createRoot(document.getElementById('app'));await act(async()=>root.render(React.createElement(PageView,{pageId:'page',theme:'light'})))
  await click(type==='table'?'Database':'Form');assert.equal(editor.document[0].type,'page');assert.equal(editor.document[0].props.pageId,'created-db');assert.equal(pages['created-db'].parentId,'page');assert.equal(pages['created-db'].database.views[0].type,type);assert.equal(pages['created-db'].blockOwnerId,'page');assert.ok(document.querySelector('[data-editor]'));assert.equal(failure.message,'Disk full');await act(async()=>root.unmount())
 }
})
test('locked title Enter cannot split title or insert editor content and non-text pages do not show starters',async()=>{
 reset();pages.page.locked=true;pages.page.title='Locked';const root=createRoot(document.getElementById('app'));await act(async()=>root.render(React.createElement(PageView,{pageId:'page',theme:'light'})));const el=document.querySelector('textarea');el.setSelectionRange(3,6);await key(el,'Enter');assert.equal(pages.page.title,'Locked');assert.equal(updates.length,0);assert.deepEqual(editor.document,empty);assert.equal(document.querySelector('.pg-starter'),null);await act(async()=>root.unmount())
 reset();saved=[{type:'image',props:{url:'data:image/png;base64,a'}}];editor.document=structuredClone(saved);const other=createRoot(document.getElementById('app'));await act(async()=>other.render(React.createElement(PageView,{pageId:'page',theme:'light'})));assert.equal(document.querySelector('.pg-starter'),null);await act(async()=>other.unmount())
})
test('side peek resizes by pointer and keyboard, preserves row order/mode and refuses navigation on save failure',async()=>{
 reset();pages.page.title='First';pages.hidden={id:'hidden',parentId:null,title:'Hidden'};pages.next={id:'next',parentId:null,title:'Next'};state.peekRowIds=['page','next']
 const root=createRoot(document.getElementById('app'));await act(async()=>root.render(React.createElement(PagePeek,{theme:'light'})))
 assert.equal(document.querySelector('[role=dialog]').getAttribute('aria-modal'),'false');const divider=document.querySelector('[role=separator]');assert.ok(divider)
 await key(divider,'ArrowLeft');assert.equal(state.peekWidth,752)
 await act(async()=>root.render(React.createElement(PagePeek,{theme:'light'})))
 await act(async()=>{const start=new dom.window.MouseEvent('pointerdown',{clientX:300,button:0,bubbles:true});divider.dispatchEvent(start);window.dispatchEvent(new dom.window.MouseEvent('pointermove',{clientX:350,bubbles:true}));window.dispatchEvent(new dom.window.MouseEvent('pointerup',{clientX:350,bubbles:true}))});assert.equal(state.peekWidth,702);assert.equal(closes,0);assert.equal(document.body.classList.contains('peek-resizing'),false)
 await click('Next page');assert.equal(state.peekPageId,'next');assert.equal(state.peekMode,'side');assert.deepEqual(state.peekRowIds,['page','next'])
 state.peekPageId='page';failure=Error('Cannot save');await click('Open full page');assert.deepEqual(opened,[]);assert.equal(state.peekPageId,'page');await key(window,'\\',{metaKey:true});assert.equal(closes,0)
 failure=null;metaFailure=Error('Metadata write failed');await click('Open full page');assert.deepEqual(opened,[]);assert.equal(state.peekPageId,'page');metaFailure=null;failure=null;await click('Open full page');assert.deepEqual(opened,['page']);await key(window,'\\',{metaKey:true});assert.equal(closes,1)
 await act(async()=>root.unmount())
})

test('typing while a template panel is open closes it without replacing the current content',async()=>{
 reset();const root=createRoot(document.getElementById('app'));await act(async()=>root.render(React.createElement(PageView,{pageId:'page',theme:'light'})))
 await click('Templates');assert.ok(document.querySelector('.pg-starter-templates'))
 const content=[{id:'user-text',type:'paragraph',content:[{type:'text',text:'Keep my text',styles:{}}]}]
 await act(async()=>{editor.document=content;listeners.forEach(fn=>fn())})
 assert.equal(Boolean(document.querySelector('.pg-starter-templates')),false);assert.deepEqual(editor.document,content)
 await act(async()=>root.unmount())
})

test('database row clicks capture visible order, use per-view modes and retain the previous preview on a failed save',async()=>{
 reset();const view={id:'view',name:'Table',type:'table',filters:[],sorts:[],hidden:[],widths:{}}
 const database={properties:[{id:'title',name:'Name',type:'title'}],views:[view],activeViewId:'view'}
 pages.db={id:'db',parentId:null,title:'Database',database};pages['row-a']={id:'row-a',parentId:'db',title:'A'};pages['row-b']={id:'row-b',parentId:'db',title:'B'};pages.hidden={id:'hidden',parentId:'db',title:'Hidden'}
 Object.assign(mocks,{normalizeSearch:value=>value.toLowerCase(),applyView:()=>[pages['row-b'],pages['row-a']],visibleProperties:schema=>schema.properties,groupableProperty:()=>undefined,ViewTypeIcon:()=>null,dbEvents:{}})
 mocks.selectors.database=id=>pages[id]?.database;mocks.selectors.rows=()=>[pages['row-a'],pages.hidden,pages['row-b']]
 for(const name of ['TableView','BoardView','CalendarView','ListView','GalleryView','TimelineView','ChartView','DashboardView','FeedView','FormView','MapView'])mocks[name]=props=>React.createElement('div',null,props.rows.map(row=>React.createElement('button',{key:row.id,onClick:()=>props.onOpenRow(row.id)},row.title)))
 mocks.actions.openPeek=(id,mode,ids)=>{state.peekPageId=id;state.peekMode=mode;state.peekRowIds=ids??state.peekRowIds}
 const {DatabaseView}=await load('../src/components/database/DatabaseView.tsx');const root=createRoot(document.getElementById('app'))
 state.peekPageId=null;const render=()=>root.render(React.createElement(DatabaseView,{pageId:'db'}))
 await act(async()=>render());await click('B');assert.equal(state.peekPageId,'row-b');assert.equal(state.peekMode,'side');assert.deepEqual(state.peekRowIds,['row-b','row-a'])
 failure=Error('Disk full');await click('A');assert.equal(state.peekPageId,'row-b');failure=null
 view.type='gallery';await act(async()=>render());await click('A');assert.equal(state.peekMode,'center')
 view.openPagesIn='side';await act(async()=>render());await click('B');assert.equal(state.peekMode,'side')
 view.openPagesIn='full';await act(async()=>render());await click('A');assert.deepEqual(opened,['row-a'])
 await act(async()=>root.unmount())
})
