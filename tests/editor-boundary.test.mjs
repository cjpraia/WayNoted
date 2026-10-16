import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {JSDOM} from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
const dom=new JSDOM('<!doctype html><body><div id="app"></div></body>')
for(const name of ['window','document','navigator','HTMLElement'])Object.defineProperty(globalThis,name,{configurable:true,value:dom.window[name]})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const source=await readFile(new URL('../src/components/page/EditorBoundary.tsx',import.meta.url),'utf8')
const transformed=await transformWithOxc(source,'EditorBoundary.tsx',{jsx:{runtime:'automatic'}})
const code=transformed.code.replace(/from ["'](react(?:\/jsx-runtime)?)["']/g,(_m,name)=>`from ${JSON.stringify(import.meta.resolve(name))}`).replace(/from ["']\.\.\/\.\.\/localization\.ts["']/g,`from ${JSON.stringify(new URL('../src/localization.ts',import.meta.url).href)}`)
const {EditorBoundary}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
test('editor render failure preserves page controls, presents localized recovery, and resets after reloading',async()=>{
 let retry=0,fail=true
 const root=createRoot(document.getElementById('app'),{onCaughtError(){}})
 function Editor(){if(fail)throw new Error('Unsupported stored block');return React.createElement('p',null,'Recovered content')}
 const render=(resetKey,locale)=>React.createElement(React.Fragment,null,React.createElement('button',null,'Version history'),React.createElement(EditorBoundary,{resetKey,locale,onRetry:()=>retry++},React.createElement(Editor)))
 await act(async()=>root.render(render('page:0','en-US')))
 assert.match(document.querySelector('[role="alert"]').textContent,/saved file was preserved/)
 assert.match(document.querySelector('[role="alert"]').textContent,/Unsupported stored block/)
 assert.ok([...document.querySelectorAll('button')].find(button=>button.textContent==='Version history'))
 await act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Reload content').click());assert.equal(retry,1)
 await act(async()=>root.render(render('page:0','pt-BR')));assert.match(document.querySelector('[role="alert"]').textContent,/O arquivo salvo foi preservado/)
 fail=false;await act(async()=>root.render(render('page:1','pt-BR')))
 assert.equal(document.querySelector('[role="alert"]'),null);assert.match(document.body.textContent,/Recovered content/)
 await act(async()=>root.unmount())
})
