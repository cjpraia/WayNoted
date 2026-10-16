import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {JSDOM} from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
import { BLOCKNOTE_NOTICE, WORKSPACE_LICENSE } from '../src/legal.ts'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import {shimUi} from './fixtures/ui-shim.mjs'
const dom=new JSDOM('<!doctype html><body><div id="app"></div></body>',{url:'http://localhost'})
for(const name of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Event','Node','Element'])Object.defineProperty(globalThis,name,{configurable:true,value:dom.window[name]})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
// React detects the DOM on load: import only after the jsdom globals exist.
const {act,createElement}=await import('react')
const {createRoot}=await import('react-dom/client')
const text='# Avisos\n| react | 19 | MIT |\n| @blocknote/core | 0.55.0 | MPL-2.0 |\n| pdf-lib | 1 | MIT |'
let copied=[],revealed=0
const deps={api:{readThirdPartyNotices:async()=>({found:true,text,version:'2.3.4'}),revealThirdPartyNotices:async()=>{revealed++}},
 t:(_pt,en)=>en,copyText:async v=>{copied.push(v)},
 PanelHeader:({title,onBack})=>createElement('div',null,createElement('strong',null,title),createElement('button',{onClick:onBack},'Back')),
 Textarea:({className,...r})=>createElement('textarea',{className,...r})}
globalThis.__tpn=deps
let source=await readFile(new URL('../src/components/modals/ThirdPartyNotices.tsx',import.meta.url),'utf8')
source=source.replace("import { api } from '../../store'","const {api}=globalThis.__tpn").replace("import { t } from '../../i18n'","const {t}=globalThis.__tpn").replace("import { copyText } from '../../clipboard'","const {copyText}=globalThis.__tpn")
 .replace("import { BLOCKNOTE_NOTICE, WORKSPACE_LICENSE } from '../../legal'",`const BLOCKNOTE_NOTICE=${JSON.stringify(BLOCKNOTE_NOTICE)},WORKSPACE_LICENSE=${JSON.stringify(WORKSPACE_LICENSE)}`)
 .replace("import { PanelHeader } from '../ui/PanelHeader'","const {PanelHeader}=globalThis.__tpn").replace("import { Textarea } from '../ui/Textarea'","const {Textarea}=globalThis.__tpn").replace("import './ThirdPartyNotices.css'","")
source=shimUi(source)
const out=await transformWithOxc(source,'ThirdPartyNotices.tsx',{jsx:{runtime:'automatic'}})
const code=out.code.replace(/from ["'](react(?:\/jsx-runtime)?)["']/g,(_m,n)=>`from ${JSON.stringify(import.meta.resolve(n))}`)
const {ThirdPartyNotices,filterNotices}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const roots=new Set()
afterEach(async()=>{await act(async()=>{for(const r of roots)r.unmount()});roots.clear()})

test('filterNotices keeps only matching lines',()=>{
 assert.equal(filterNotices(text,'').text,text)
 const r=filterNotices(text,'mpl');assert.equal(r.matches,1);assert.ok(r.text.includes('blocknote'))
})
test('screen shows fixed notice, version, license, search, copy and reveal',async()=>{
 const root=createRoot(document.getElementById('app'));roots.add(root)
 await act(async()=>root.render(createElement(ThirdPartyNotices,{onClose(){}})))
 await act(async()=>{await new Promise(r=>setTimeout(r,10))})
 const body=document.body.textContent
 assert.ok(body.includes('MPL-2.0')&&body.includes('2.3.4')&&body.includes(WORKSPACE_LICENSE.en))
 assert.ok(body.includes('noncommercial use permitted') && body.includes('Commercial use requires separate permission'))
 const area=document.querySelector('textarea');assert.ok(area.readOnly===true);assert.ok(area.value===text)
 const search=document.querySelector('input.tpn-search')
 await act(async()=>{const set=Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set;set.call(search,'pdf-lib');search.dispatchEvent(new dom.window.Event('input',{bubbles:true}))})
 assert.equal(String(document.querySelector('textarea').value).slice(0,60),'| pdf-lib | 1 | MIT |')
 const btn=l=>[...document.querySelectorAll('button')].find(b=>b.textContent===l)
 await act(async()=>btn('Copy').click());assert.ok(copied[0]===text)
 await act(async()=>btn('Show in Finder').click());assert.equal(revealed,1)
})
