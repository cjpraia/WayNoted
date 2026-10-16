import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {JSDOM} from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import {shimUi} from './fixtures/ui-shim.mjs'
import {localIntegrationError} from '../src/components/modals/localIntegrationErrors.ts'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {assertCanClose,registerCloseGuard} from '../src/close-guards.ts'
const dom=new JSDOM('<!doctype html><body><div id="app"></div></body>',{url:'http://localhost'})
for(const name of ['window','document','navigator','HTMLElement','FileReader','Blob'])Object.defineProperty(globalThis,name,{configurable:true,value:dom.window[name]})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
let permissions=0,stopped=0,saved=[],closed=0,failSave=false,attempts=[]
Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async options=>{assert.deepEqual(options,{audio:true,video:false});permissions++;return{getTracks:()=>[{stop(){stopped++}}]}}}})
globalThis.URL.createObjectURL=()=> 'blob:test-recording'
globalThis.URL.revokeObjectURL=()=>{}
class FakeRecorder {
 static isTypeSupported(type){return type==='audio/webm;codecs=opus'}
 constructor(_,options){this.mimeType=options.mimeType;this.state='inactive'}
 start(){this.state='recording'} pause(){this.state='paused'} resume(){this.state='recording'}
 stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['local audio'],{type:this.mimeType})});this.onstop?.()}
}
globalThis.MediaRecorder=FakeRecorder
const dependencies={localIntegrationError,registerCloseGuard,api:{},actions:{async appendPageBlocks(id,blocks){attempts.push(structuredClone(blocks));if(failSave)throw new Error('disk full');saved.push({id,blocks})}},selectors:{isLive:()=>true,page:()=>({locked:false})},useI18n:()=>({t:(_pt,en)=>en})}
globalThis.__audioTest=dependencies
let source=await readFile(new URL('../src/components/modals/AudioRecorder.tsx',import.meta.url),'utf8')
source=source.replace("import { actions, api, selectors } from '../../store'",'const {actions,api,selectors}=globalThis.__audioTest').replace("import { useI18n } from '../../i18n'",'const {useI18n}=globalThis.__audioTest').replace("import { registerCloseGuard } from '../../close-guards'",'const {registerCloseGuard}=globalThis.__audioTest').replace("import { localIntegrationError } from './localIntegrationErrors'",'const {localIntegrationError}=globalThis.__audioTest').replace("import './AudioRecorder.css'",'')
source=shimUi(source)
const transformed=await transformWithOxc(source,'AudioRecorder.tsx',{jsx:{runtime:'automatic'}})
const code=transformed.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g,(_m,name)=>`from ${JSON.stringify(import.meta.resolve(name))}`)
const {AudioRecorder}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
async function waitFor(predicate,label) {
 const deadline=Date.now()+3000
 while(!predicate()) {
  if(Date.now()>=deadline)assert.fail(`Timed out waiting for ${label}`)
  await act(async()=>new Promise(resolve=>setTimeout(resolve,5)))
 }
}
const click=async name=>{
 const button=[...document.querySelectorAll('button')].find(el=>el.textContent===name)
 assert.ok(button,`button ${name}`);assert.equal(button.disabled,false,`${name} must be enabled`)
 const beforeAttempts=attempts.length
 await act(async()=>button.click())
 if(name==='Add to page')await waitFor(()=>attempts.length>beforeAttempts&&!document.querySelector('.rec-actions button')?.disabled,'audio persistence and settled save button')
 if(name==='Transcribe locally')await waitFor(()=>!!document.querySelector('textarea')&&!document.body.textContent.includes('Transcribing on device…'),'completed transcription preview')
 if(name==='Add transcription to page')await waitFor(()=>document.body.textContent.includes('Transcription added.'),'confirmed transcript persistence')
}
const mounted=new Set()
const mount=async()=>{
 const root=createRoot(document.getElementById('app'));mounted.add(root)
 const unmount=root.unmount.bind(root);root.unmount=()=>{mounted.delete(root);unmount()}
 await act(async()=>root.render(React.createElement(AudioRecorder,{pageId:'page',onClose:()=>closed++})))
 return root
}
// Always clean up, including after an assertion throws, so failures cannot cascade.
afterEach(async()=>{await act(async()=>{for(const root of [...mounted])root.unmount()});failSave=false})

test('microphone is requested only on Record; pause, stop, and local attachment retain the captured bytes',async()=>{
 const root=await mount();assert.equal(permissions,0);assert.doesNotThrow(assertCanClose)
 await click('Record');assert.equal(permissions,1);assert.throws(assertCanClose,/Save or discard the recording/)
 await click(' Pause');await click(' Resume');await click('Stop')
 assert.ok(stopped>0);assert.throws(assertCanClose,/Save or discard the recording/);assert.equal(document.querySelector('audio').src,'blob:test-recording')
 await click('Add to page');assert.equal(saved.length,1);assert.equal(closed,1)
 assert.equal(saved[0].blocks[0].type,'audio');assert.match(saved[0].blocks[0].props.url,/^data:audio\/webm;codecs=opus;base64,/)
 assert.equal(Buffer.from(saved[0].blocks[0].props.url.split(',')[1],'base64').toString(),'local audio')
 await act(async()=>root.unmount());assert.doesNotThrow(assertCanClose)
})
test('failed persistence preserves playback/download and allows retry; unmount releases recording tracks',async()=>{
 const root=await mount();await click('Record');await click('Stop');failSave=true
 const before=closed;await click('Add to page');assert.equal(closed,before);assert.match(document.querySelector('[role="alert"]').textContent,/disk full/);assert.ok(document.querySelector('a[download]'))
 const failedAttempt=attempts.at(-1);failSave=false;await click('Add to page');assert.deepEqual(attempts.at(-1),failedAttempt);assert.equal(closed,before+1);await act(async()=>root.unmount())
 const another=await mount();await click('Record');const stopBefore=stopped;await act(async()=>another.unmount());assert.ok(stopped>stopBefore)
})

test('local transcription requires selected model, previews output, and saves text only on confirmation',async()=>{
 let transcriptions=0,cancels=0
 dependencies.api.pickTranscriptionModel=async()=>'/selected/local-model.bin'
 dependencies.api.transcribeAudio=async request=>{transcriptions++;assert.equal(request.modelPath,'/selected/local-model.bin');assert.equal(request.language,'auto');assert.equal(Buffer.from(request.data).toString(),'local audio');return 'Transcribed locally.\n\nSecond paragraph.'}
 dependencies.api.cancelTranscription=async()=>{cancels++}
 const root=await mount();await click('Record');await click('Stop');assert.equal(transcriptions,0)
 const initialSaved=saved.length
 await click('Choose local model');await click('Transcribe locally');assert.equal(transcriptions,1);assert.equal(saved.length,initialSaved)
 assert.match(document.querySelector('textarea').value,/Transcribed locally/)
 await click('Add transcription to page');assert.equal(saved.length,initialSaved+1);assert.equal(saved.at(-1).blocks[0].type,'paragraph');assert.equal(saved.at(-1).blocks[0].content[0].text,'Transcribed locally.')
 await act(async()=>root.unmount());assert.equal(cancels,1)
})
