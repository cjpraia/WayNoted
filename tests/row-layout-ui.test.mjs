import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {JSDOM} from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {isEmptyPageDocument} from '../src/components/page/emptyPage.ts'
const dom=new JSDOM('<!doctype html><body><div id="app"></div></body>',{url:'http://localhost'})
for(const name of ['window','document','navigator','HTMLElement'])Object.defineProperty(globalThis,name,{configurable:true,value:dom.window[name]})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const t=(_pt,en,vars)=>en.replace(/\{(\w+)\}/g,(_,key)=>String(vars?.[key]??''))
const schema={properties:[{id:'title',name:'Name',type:'title'},{id:'first',name:'First',type:'text'},{id:'second',name:'Second',type:'text'},{id:'third',name:'Third',type:'text'}],views:[],rowLayout:{}}
const target={properties:[{id:'back',name:'Parent relation',type:'relation',relationDatabaseId:'db'}],views:[{id:'target-view',name:'Target view'}]}
const row={id:'row',parentId:'db',title:'Row',props:{first:'One',second:'Two',third:'Three'}}
const db={id:'db',title:'Database',database:schema}
const mocks={t,DailyNoteNav:()=>null,isEmptyPageDocument,flushDoc:async()=>{},assertCanClose:()=>{},PageComments:()=>null,RowLayoutSettings:()=>null,UnlinkedMentions:()=>null,ChildPages:()=>null,actions:{},getState:()=>({pages:{db,target:{id:'target',title:'Related database',database:target}}}),selectors:{isLive:()=>true,page:()=>row,parentDatabase:()=>db,database:id=>id==='target'?target:schema,rows:()=>[row]},useStore:()=>({}),getValue:(r,p)=>r.props[p.id],isEmptyValue:value=>value==null,PropDisplay:({value})=>React.createElement('span',null,value),PropTypeIcon:()=>null,PropertyEditor:()=>null,NewPropertyMenu:()=>null,PropertyMenu:()=>null,CellComments:()=>null,isComputedProperty:()=>false,subitemsFor:()=>[],unresolvedDependencies:()=>[],canAssignSubitemParent:()=>false,openUrl:()=>{},addProperty:()=>{}}
Object.assign(mocks,{typeDataHidden:()=>false,pageTypes:()=>[],pageTypeFields:()=>[],TypeFieldRows:()=>null,FieldTypeMenu:()=>null,PageIcon:()=>null,DbPopover:()=>null,Menu:()=>null,MenuItem:()=>null,MenuLabel:()=>null,addField(){},Select:props=>React.createElement('select',props),useReorder:()=>({row:()=>({}),grip:()=>null,dragId:null}),announceReorder(){},moveRelative:list=>list,moveProperty(){},objectTypes:()=>[],typesAsTemplates:()=>[],sidebarTypes:()=>[],applyTypeFlow:async()=>0,TypeHeader:()=>null,TypeFields:()=>null,TypeTagSuggestion:()=>null,registerTypeEditor:()=>()=>{},rowTemplateHasQuestions:()=>false,askRowTemplate:async()=>undefined,insertTextInPageEditor:()=>false,VariablePicker:()=>null,hasPendingCursor:()=>false,applyPendingCursor:()=>false,placeCursor:()=>false,prepareTemplate:async blocks=>({blocks,unknown:[],cursor:null,answers:{}})})
globalThis.__rowLayout=mocks
// Painel de configurações e seleção de linhas do DatabaseView (docs/DEVELOPMENT.md).
Object.assign(mocks,await import('../src/components/database/rowSelection.ts'),{viewBodyClasses:(await import('../src/components/database/settings/model.ts')).viewBodyClasses,Icon:()=>null,BulkBar:()=>null,ViewSettingsPanel:()=>null,ViewTabMenu:()=>null,
 // Visualização vinculada (docs/USAGE.md): estes bancos não são vinculados.
 linkedSourceOf:()=>undefined,AddViewPanel:()=>null,LinkedBadge:()=>null,LinkedTitle:()=>null,MissingSource:()=>null,linkedTipSeen:()=>true,markLinkedTipSeen(){},LINKED_SCHEMA_NOTICE_KEY:'k'})
async function load(file){
 let source=await readFile(new URL(file,import.meta.url),'utf8')
 source=source.replace(/import\s+(\{[\s\S]*?\})\s+from\s+'([^']+)'/g,(match,bindings,module)=>{
  if(module==='react'||module==='lucide-react')return match
  return `const ${bindings.replace(/\btype\s+\w+\s*,?/g,'')}=globalThis.__rowLayout`
 }).replace(/^import type .*$/gm,'').replace(/^import '[^']+\.css'$/gm,'')
 const out=await transformWithOxc(source,file,{jsx:{runtime:'automatic'}})
 return import(`data:text/javascript;base64,${Buffer.from(out.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g,(_m,name)=>`from ${JSON.stringify(import.meta.resolve(name))}`)).toString('base64')}`)
}
const {RowLayoutSettings}=await load('../src/components/database/RowLayoutSettings.tsx')
const {RowProperties}=await load('../src/components/database/RowProperties.tsx')
test('layout controls move properties between page, heading and details and configure related tabs',async()=>{
 const root=createRoot(document.getElementById('app'))
 function Layout(){const [layout,setLayout]=React.useState({});schema.rowLayout=layout;return React.createElement(React.Fragment,null,React.createElement(RowLayoutSettings,{dbId:'db',schema,patch:setLayout}),...['main','pinned','details'].map(placement=>React.createElement(RowProperties,{key:placement,pageId:'row',placement})))}
 await act(async()=>root.render(React.createElement(Layout)))
 const select=async(label,value)=>{const el=document.querySelector(`select[aria-label="${label}"]`);assert.ok(el,label);await act(async()=>{el.value=value;el.dispatchEvent(new dom.window.Event('change',{bubbles:true}))})}
 await select('First placement','pinned');await select('Second placement','details');await select('Third placement','hidden')
 assert.equal(document.querySelector('.dbv-rowprops-main [data-prop="first"]'),null)
 assert.ok(document.querySelector('.dbv-rowprops-pinned [data-prop="first"]'))
 assert.ok(document.querySelector('.dbv-rowprops-details [data-prop="second"]'))
 assert.equal(document.querySelector('[data-prop="third"]'),null)
 const header=[...document.querySelectorAll('header')].find(el=>el.textContent==='Related database tabs')
 await act(async()=>header.querySelector('button').click())
 await select('Tab database','target');await select('Tab view','target-view');await select('Filter by current page','back')
 assert.equal(schema.rowLayout.tabs[0].databaseId,'target');assert.equal(schema.rowLayout.tabs[0].viewId,'target-view');assert.equal(schema.rowLayout.tabs[0].relationPropertyId,'back')
 await act(async()=>root.unmount())
})

test('page switches content/related tab, filters rows and retains contextual links when creating through shared views',async()=>{
 const {mergeRowCreationProps}=await import('../src/components/database/rowCreation.ts')
 const rows=[{id:'included',parentId:'target',title:'Included',props:{back:['row']}},{id:'excluded',parentId:'target',title:'Excluded',props:{back:['other']}}]
 const created=[]
 const targetView={id:'target-view',name:'Target view',type:'table',filters:[],sorts:[],hidden:[],widths:{}}
 target.views=[targetView];target.activeViewId=targetView.id
 schema.rowLayout={pinnedPropertyIds:['first'],detailsPropertyIds:['second'],tabs:[{id:'related',name:'Related records',databaseId:'target',viewId:'target-view',relationPropertyId:'back'}]}
 const targetPage={id:'target',title:'Related database',database:target}
 Object.assign(mocks.selectors,{page:id=>id==='row'?row:id==='target'?targetPage:id==='db'?db:rows.find(r=>r.id===id),backlinks:()=>[],rows:id=>id==='target'?rows:[row]})
 Object.assign(mocks.actions,{createRow:(id,props)=>{const idNew=`created-${created.length}`;const value={id:idNew,parentId:id,title:'Created '+created.length,props};rows.push(value);created.push(value);return idNew},openPeek:()=>{}})
 Object.assign(mocks,{useStore:()=>({docRevision:0,route:{type:'page',id:'row'}}),api:{loadDoc:async()=>[]},defaultsForNewRow:(_schema,_view,values,context)=>mergeRowCreationProps({},values,context),defaultsFromFilters:()=>({}),normalizeSearch:value=>value.toLowerCase(),applyView:rows=>rows,visibleProperties:s=>s.properties,groupableProperty:()=>undefined,ViewTypeIcon:()=>null,PageIcon:()=>null,dbEvents:{},EditorBoundary:({children})=>children,RowProperties,PageEditor:()=>React.createElement('div',{'data-testid':'body'},'Page body'),loadDraft:async()=>null,deleteDraft:async()=>{},isDocDirty:()=>false,useI18n:()=>({locale:'en-US',t})})
 const {useRowCreation}=await load('../src/components/database/views/shared/rows.tsx')
 function View(props){const {create}=useRowCreation(props.db,props.schema,props.view,props.creationDefaults);return React.createElement('div',{'data-testid':'rows'},props.rows.map(row=>React.createElement('p',{key:row.id},row.title)),React.createElement('button',{onClick:()=>create()},'Shared inline new'))}
 for(const key of ['TableView','BoardView','CalendarView','ListView','GalleryView','TimelineView','ChartView','DashboardView','FeedView','FormView','MapView'])mocks[key]=View
 const {DatabaseView}=await load('../src/components/database/DatabaseView.tsx');mocks.DatabaseView=DatabaseView
 const {PageView}=await load('../src/components/page/PageView.tsx')
 const root=createRoot(document.getElementById('app'))
 const render=()=>root.render(React.createElement(PageView,{pageId:'row',theme:'light'}))
 await act(async()=>render())
 assert.ok(document.querySelector('[data-testid="body"]'));assert.ok(document.querySelector('.dbv-rowprops-pinned [data-prop="first"]'))
 const click=async text=>{const button=[...document.querySelectorAll('button')].find(el=>el.textContent===text);assert.ok(button,text);await act(async()=>button.click())}
 await click('View details');assert.ok(document.querySelector('aside [data-prop="second"]'))
 await click('Related records');assert.ok(document.querySelector('[data-testid="body"]').closest('[hidden]'))
 assert.match(document.querySelector('[data-testid="rows"]').textContent,/Included/);assert.doesNotMatch(document.querySelector('[data-testid="rows"]').textContent,/Excluded/)
 await click('New');await click('Shared inline new');assert.equal(created.length,2)
 for(const createdRow of created)assert.deepEqual(createdRow.props.back,['row'])
 await act(async()=>render());assert.match(document.querySelector('[data-testid="rows"]').textContent,/Created 0/)
 await click('Content');assert.equal(Boolean(document.querySelector('[data-testid="body"]').closest('[role="tabpanel"]').hidden),false)
 await act(async()=>root.unmount())
})
