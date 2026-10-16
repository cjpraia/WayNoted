// Real PageEditor lifecycle; only BlockNote rendering and storage boundaries are simulated.
// Native atomic candidate persistence is covered independently by desktop-features tests.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {JSDOM} from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {blocksToText,markDocDirty,registerFlush,flushDoc,flushAllDocs,isDocDirty} from '../src/components/page/util.ts'
import {assertCanClose} from '../src/close-guards.ts'
import {localPageLink,editorLinks} from '../src/components/page/links.ts'
import {copyText} from '../src/clipboard.ts'
const dom=new JSDOM('<!doctype html><body><div id="app"></div></body>',{url:'http://localhost'})
for(const name of ['window','document','navigator','HTMLElement'])Object.defineProperty(globalThis,name,{configurable:true,value:dom.window[name]})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const blocks=text=>[{id:'block',type:'paragraph',props:{},content:[{type:'text',text,styles:{}}],children:[]}]
let editor,onChange,save,reloaded,settings,drafts,candidates,writes,slashContext,slashItems
const t=(_pt,en)=>en
const mocks={
 filterSuggestionItems:items=>items,insertOrUpdateBlockForSlashMenu:()=>{},en:{},pt:{},locales:{en:{},pt:{}},
 SuggestionMenuController:props=>{if(props.triggerCharacter==='/')slashItems=props.getItems;return null},SideMenuController:()=>null,FormattingToolbarController:()=>null,BundleFormattingToolbar:()=>null,getDefaultReactSlashMenuItems:()=>[],useCreateBlockNote:()=>editor,
 BlockNoteView:props=>{onChange=props.onChange;return React.createElement('div',null,props.children)},
 currentViewKey:()=>'test|page|page',getViewState:()=>undefined,setSelectionProvider:()=>{},
 actions:{reportSaveError:()=>{},updatePage:()=>{},reloadDocument:async()=>{reloaded++},setSettingsOpen:()=>{settings++}},
 api:{saveDoc:async(...args)=>{writes++;return save(...args)}},selectors:{page:()=>({id:'page',title:'Page'}),isLive:()=>true},useStore:()=>({pages:{page:{id:'page',title:'Page'}},syncedBlocks:{}}),
 schema:{},editorLinks,localPageLink,dailyNoteLink:/^workspace:\/\/daily\//,mentionFromText:()=>null,handleDailyLink:()=>false,iconLabel:()=>'',blocksToText,flushDoc,markDocDirty,registerFlush,copyText,captureBlockTextAnchor:()=>null,
 deleteDraft:async()=>{drafts=[]},saveDraft:async(_id,value)=>{drafts=structuredClone(value)},findInBlocks:()=>[],replaceBlockText:()=>[],t,useI18n:()=>({locale:'en-US',t}),editorExtensions:()=>[],
 ListDropNestingExtension:()=>({}),BlockDropExtension:()=>({}),blockDropCursor:{},buildSlashItems:context=>{slashContext=context;return []},handleQueryShortcut:()=>false,registerQueryEditor:()=>()=>{},executeSlashCommand:()=>{},LocalSlashMenu:()=>null,LocalAIModal:()=>null,EditorSideMenu:()=>null,importPageFile:async()=>'',singlePastedUrl:()=>null,pasteUrlAndCapture:()=>null,pastedUrlIsVideo:()=>false,applyPastedUrlChoice:()=>false,useSmartPaste:()=>({handle:()=>true,onKeyDownCapture:()=>{},element:null}),
}
globalThis.__editorLifecycle=mocks
let source=await readFile(new URL('../src/components/page/PageEditor.tsx',import.meta.url),'utf8')
// Keep the production component verbatim; rewrite its imports only.
source=source.replace(/import\s+(\{[\s\S]*?\})\s+from\s+'([^']+)'/g,(match,bindings,module)=>{
 if(module==='react'||module==='lucide-react'||module==='../../types')return match
 const names=bindings.replace(/\btype\s+\w+\s*,?/g,'').replace(/\b(\w+)\s+as\s+(\w+)/g,'$1: $2')
 return `const ${names}=globalThis.__editorLifecycle`
}).replace("import '@blocknote/mantine/style.css'",'')
const transformed=await transformWithOxc(source,'PageEditor.tsx',{jsx:{runtime:'automatic'}})
const code=transformed.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g,(_m,name)=>`from ${JSON.stringify(import.meta.resolve(name))}`)
const {PageEditor}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
async function mount(){
 editor={document:blocks('initial'),getTextCursorPosition:()=>({block:{id:'block'}})};reloaded=0;settings=0;drafts=[];candidates=[];writes=0
 const root=createRoot(document.getElementById('app'))
 await act(async()=>root.render(React.createElement(PageEditor,{pageId:'page',initial:blocks('initial'),theme:'light',editable:true,onReady:()=>{}})))
 return root
}
async function change(text){await act(async()=>{editor.document=blocks(text);onChange()})}
async function flush(){await act(async()=>flushDoc('page'))}
async function unmount(root){await act(async()=>{root.unmount();await flushAllDocs()});assert.equal(isDocDirty('page'),false);assert.doesNotThrow(assertCanClose)}
async function click(label){const button=[...document.querySelectorAll('button')].find(item=>item.textContent===label);assert.ok(button,label);await act(async()=>{button.click();await new Promise(resolve=>setTimeout(resolve,0))})}
function preserve(code){save=async(_id,value)=>{candidates.push(structuredClone(value));throw new Error(`${code}: saved candidate`)}}

test('preserved conflict releases flush, keeps history candidate and allows reload then close',async()=>{
 const root=await mount();preserve('DOC_CONFLICT');await change('my conflicting edit');await flush()
 assert.equal(candidates[0][0].content[0].text,'my conflicting edit');assert.equal(isDocDirty('page'),false)
 await flush();assert.equal(writes,1)
 await click('Load saved version; keep my copy in history');assert.equal(reloaded,1);assert.deepEqual(drafts,[])
 await unmount(root);assert.equal(candidates.length,1)
})
test('deleted-page candidate permits opening recovery and subsequent close',async()=>{
 const root=await mount();preserve('DOC_DELETED');await change('edit after deletion');await flush()
 await click('Open recovery');assert.equal(settings,1);assert.equal(candidates[0][0].content[0].text,'edit after deletion')
 await unmount(root);assert.equal(writes,1)
})
test('new typing while conflict is being preserved gets its own candidate before clean close',async()=>{
 const root=await mount();let release,started
 const savingStarted=new Promise(resolve=>{started=resolve})
 save=async(_id,value)=>{if(!candidates.length){started();await new Promise(resolve=>{release=resolve})}candidates.push(structuredClone(value));throw new Error('DOC_CONFLICT: saved candidate')}
 await change('first edit');let flushing
 await act(async()=>{flushing=flushDoc('page');await savingStarted})
 await change('newer edit');await act(async()=>{release();await flushing})
 assert.deepEqual(candidates.map(value=>value[0].content[0].text),['first edit','newer edit'])
 assert.equal(isDocDirty('page'),false);await unmount(root);assert.equal(writes,2)
})
test('ordinary disk failure stays dirty and blocks flush until persistence really succeeds',async()=>{
 const root=await mount();save=async()=>{throw new Error('disk full')};await change('must survive')
 await act(async()=>{await assert.rejects(flushDoc('page'),/disk full/)});assert.equal(isDocDirty('page'),true)
 await act(async()=>{await assert.rejects(flushAllDocs(),/disk full/)})
 save=async(_id,value)=>{candidates.push(structuredClone(value))};await flush()
 assert.equal(candidates[0][0].content[0].text,'must survive');assert.deepEqual(drafts,[])
 await unmount(root)
})

test('real editor link capture routes local links and allows explicit web clicks; clipboard copies active block',async()=>{
 const root=await mount(),opened=[],tabs=[],copied=[]
 mocks.actions.openPage=(...args)=>opened.push(args);mocks.actions.openInNewTab=route=>tabs.push(route)
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>copied.push(text)}})
 const id='01234567-1234-1234-1234-0123456789ab'
 async function follow(href,options={}){
  const anchor=document.createElement('a');anchor.setAttribute('href',href);document.querySelector('#app > div').append(anchor)
  const event=new dom.window.MouseEvent('click',{bubbles:true,cancelable:true,...options})
  // Invoke the real delegated handler without browser default navigation.
  let prevented
  const cancelDefault=e=>{prevented=e.defaultPrevented;e.preventDefault()}
  document.addEventListener('click',cancelDefault,{once:true})
  await act(async()=>anchor.dispatchEvent(event));document.removeEventListener('click',cancelDefault);anchor.remove()
  return prevented??event.defaultPrevented
 }
 assert.equal(await follow(`workspace://page/${id}`),true);assert.equal(opened[0][0],id)
 assert.equal(await follow(`workspace://page/${id}`,{ctrlKey:true}),true);assert.deepEqual(tabs[0],{type:'page',id})
 assert.equal(await follow('https://example.com'),false)
 for(const href of ['javascript:alert(1)','file:///tmp/private','data:text/html,hi'])assert.equal(await follow(href),true)
 await slashItems('copy');await act(async()=>slashContext.onCopy());assert.equal(copied[0],"workspace://page/page#block=block")
 await unmount(root)
})
