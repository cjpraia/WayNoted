import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {JSDOM} from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
const dom=new JSDOM('<!doctype html><body><main><aside>Sidebar</aside><section id="main"><div class="pg-root" data-page-id="main">Main page</div></section></main><div id="peek"><header>Toolbar</header><section><div class="pg-root" data-page-id="peek">Peek page</div></section></div><div id="menu">Export menu</div></body>')
globalThis.document=dom.window.document
let flushed=0,called=0,fail=false
const mocks={actions:{flushAll:async()=>flushed++},api:{exportPDF:async()=>{
 called++;const target=document.querySelector('.np-print-target');assert.equal(target.dataset.pageId,'peek')
 const hidden=[...document.querySelectorAll('.np-print-ancestor > :not(.np-print-ancestor):not(.np-print-target)')]
 assert.ok(hidden.some(el=>el.tagName==='MAIN'));assert.ok(hidden.some(el=>el.id==='menu'));assert.ok(hidden.some(el=>el.tagName==='HEADER'))
 if(fail)throw new Error('disk full');return true
}},t:(_pt,en)=>en}
globalThis.__printTest=mocks
let source=await readFile(new URL('../src/components/modals/printPage.ts',import.meta.url),'utf8')
source=source.replace("import { actions, api } from '../../store'",'const {actions,api}=globalThis.__printTest').replace("import { t } from '../../i18n'",'const {t}=globalThis.__printTest')
const {code}=await transformWithOxc(source,'printPage.ts')
const {exportVisiblePage}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
test('PDF export flushes and isolates requested peek content, cleaning all markers after success or failure',async()=>{
 assert.equal(await exportVisiblePage('peek','page.pdf'),true);assert.equal(flushed,1);assert.equal(called,1)
 assert.equal(document.querySelectorAll('.np-print-target,.np-print-ancestor').length,0)
 fail=true;await assert.rejects(exportVisiblePage('peek','page.pdf'),/disk full/);assert.equal(document.querySelectorAll('.np-print-target,.np-print-ancestor').length,0)
 const before=called;await assert.rejects(exportVisiblePage('missing','page.pdf'),/Open the page/);assert.equal(called,before)
})
