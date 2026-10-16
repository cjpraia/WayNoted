import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true })
for (const key of ['window','document','Node','Text','Element','HTMLElement','HTMLDivElement','HTMLInputElement','HTMLTextAreaElement','HTMLAnchorElement','HTMLImageElement','HTMLMediaElement','DocumentFragment','DOMParser','MutationObserver','DOMRect','Range','ShadowRoot']) Object.defineProperty(globalThis,key,{configurable:true,value: key==='window'?dom.window:key==='document'?dom.window.document:dom.window[key]})
Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator})
globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window)
globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window)
globalThis.ResizeObserver=class {observe(){}unobserve(){}disconnect(){}}
dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}})
const {BlockNoteEditor,BlockNoteSchema,defaultBlockSpecs}=await import('@blocknote/core')
const {editorStyleSpecs}=await import('../src/components/page/editorStyles.ts')
const schema=BlockNoteSchema.create({styleSpecs:editorStyleSpecs})

test('default editor blocks survive JSON serialization and reopening with their meaningful properties',()=>{
 const types=['paragraph','heading','bulletListItem','numberedListItem','checkListItem','toggleListItem','quote','divider','codeBlock','table','image','audio','video','file']
 for(const type of types)assert.ok(defaultBlockSpecs[type],`installed editor supports ${type}`)
 const content=[
  {id:'paragraph',type:'paragraph',content:[{type:'text',text:'Bold + italic',styles:{bold:true,italic:true,textColor:'red',backgroundColor:'yellow'}}]},
  {id:'heading',type:'heading',props:{level:2},content:'Heading'},
  {id:'bullet',type:'bulletListItem',content:'Bullet',children:[{id:'nested',type:'bulletListItem',content:'Nested'}]},
  {id:'number',type:'numberedListItem',content:'Number'},
  {id:'check',type:'checkListItem',props:{checked:true},content:'Done'},
  {id:'toggle',type:'toggleListItem',content:'Toggle',children:[{id:'child',type:'paragraph',content:'Hidden child'}]},
  {id:'quote',type:'quote',content:'Quoted'}, {id:'divider',type:'divider'},
  {id:'code',type:'codeBlock',props:{language:'javascript'},content:'const value = 42;'},
  {id:'table',type:'table',content:{type:'tableContent',rows:[{cells:['Name','Value']},{cells:['A','42']}]}},
  ...['image','audio','video','file'].map((type,index)=>({id:`media-${type}`,type,props:{url: type==='image'?'data:image/png;base64,aGVsbG8=':type==='audio'?'data:audio/webm;base64,aGVsbG8=':type==='video'?'data:video/mp4;base64,aGVsbG8=':'data:text/plain;base64,aGVsbG8=',name:`file-${index}`,caption:'Local caption'}})),
 ]
 const first=BlockNoteEditor.create({schema,initialContent:content})
 const persisted=JSON.parse(JSON.stringify(first.document))
 const reopened=BlockNoteEditor.create({schema,initialContent:persisted})
 assert.deepEqual(JSON.parse(JSON.stringify(reopened.document)),persisted)
 assert.equal(reopened.getBlock('check').props.checked,true)
 assert.equal(reopened.getBlock('toggle').children[0].content[0].text,'Hidden child')
 assert.equal(reopened.getBlock('code').props.language,'javascript')
 assert.equal(reopened.getBlock('table').content.rows.length,2)
 assert.equal(reopened.getBlock('paragraph').content[0].styles.bold,true)
})

test('editor conversion retains supported rich text and nested list semantics',()=>{
 const editor=BlockNoteEditor.create({schema,initialContent:[{id:'h',type:'heading',props:{level:2},content:'Example'},{id:'b',type:'bulletListItem',content:[{type:'text',text:'Strong',styles:{bold:true}}],children:[{id:'c',type:'bulletListItem',content:'Child'}]}]})
 const markdown=editor.blocksToMarkdownLossy(editor.document)
 assert.match(markdown,/## Example/)
 assert.match(markdown,/\*\*Strong\*\*/)
 assert.match(markdown,/Child/)
 const parsed=editor.tryParseMarkdownToBlocks(markdown)
 assert.equal(parsed[0].type,'heading')
 assert.equal(parsed[1].type,'bulletListItem')
 assert.equal(parsed[1].children[0].content[0].text,'Child')
})

test('block operations preserve content while converting, duplicating and changing order',()=>{
 const editor=BlockNoteEditor.create({schema,initialContent:[{id:'first',type:'paragraph',content:'First'},{id:'second',type:'paragraph',content:'Second'}]})
 editor.updateBlock('first',{type:'heading',props:{level:3}})
 assert.equal(editor.getBlock('first').content[0].text,'First')
 assert.equal(editor.getBlock('first').type,'heading')
 const source=editor.getBlock('first')
 const [copy]=editor.insertBlocks([{type:source.type,props:source.props,content:source.content,children:source.children}], 'second', 'after')
 assert.notEqual(copy.id,'first')
 assert.equal(copy.content[0].text,'First')
 editor.removeBlocks(['second'])
 editor.insertBlocks([{id:'second',type:'paragraph',content:'Second'}], 'first', 'before')
 assert.equal(editor.document[0].id,'second')
 const saved=JSON.stringify(editor.document)
 assert.equal(JSON.stringify(BlockNoteEditor.create({schema,initialContent:JSON.parse(saved)}).document),saved)
})

test('formatting, links, emoji and local image presentation survive HTML/JSON conversion',()=>{
 const editor=BlockNoteEditor.create({schema,initialContent:[{id:'text',type:'paragraph',content:[{type:'text',text:'Olá 🌱',styles:{bold:true,italic:true,underline:true,strike:true,code:true}},{type:'link',href:'https://example.com',content:[{type:'text',text:'Reference',styles:{}}]}]},{id:'picture',type:'image',props:{url:'data:image/png;base64,aGVsbG8=',caption:'Caption',previewWidth:320,textAlignment:'center'}}]})
 const html=editor.blocksToHTMLLossy(editor.document)
 assert.match(html,/Olá 🌱/)
 assert.match(html,/https:\/\/example.com/)
 const parsed=editor.tryParseHTMLToBlocks(html)
 assert.equal(parsed[0].content[0].text,'Olá 🌱')
 assert.equal(parsed[0].content[0].styles.bold,true)
 const persisted=JSON.parse(JSON.stringify(editor.document))
 const reopened=BlockNoteEditor.create({schema,initialContent:persisted})
 assert.equal(reopened.getBlock('picture').props.caption,'Caption')
 assert.equal(reopened.getBlock('picture').props.previewWidth,320)
 assert.equal(reopened.getBlock('picture').props.textAlignment,'center')
})

test('undo/redo and multi-block selection operate on document content before reopening saved state',()=>{
 const editor=BlockNoteEditor.create({schema,initialContent:[{id:'a',type:'paragraph',content:'Original'},{id:'b',type:'paragraph',content:'Second'}]})
 const host=document.createElement('div');document.body.append(host);editor.mount(host)
 editor.updateBlock('a',{content:'Edited'})
 assert.equal(editor.getBlock('a').content[0].text,'Edited')
 assert.equal(editor.undo(),true)
 assert.equal(editor.getBlock('a').content[0].text,'Original')
 assert.equal(editor.redo(),true)
 assert.equal(editor.getBlock('a').content[0].text,'Edited')
 editor.setSelection('a','b')
 assert.deepEqual(editor.getSelection().blocks.map(block=>block.id),['a','b'])
 const reopened=BlockNoteEditor.create({schema,initialContent:JSON.parse(JSON.stringify(editor.document))})
 assert.equal(reopened.getBlock('a').content[0].text,'Edited')
 editor.unmount();host.remove()
})

function typeThroughInputRules(editor,text){
 const view=editor.prosemirrorView
 for(const character of text){
  const {from,to}=view.state.selection
  const handled=view.someProp('handleTextInput',handler=>handler(view,from,to,character,()=>view.state.tr.insertText(character,from,to)))
  if(!handled)view.dispatch(view.state.tr.insertText(character,from,to))
 }
}

test('typed Markdown prefixes run installed input rules rather than import conversion',()=>{
 for(const [prefix,type,props] of [['# ','heading',{level:1}],['## ','heading',{level:2}],['### ','heading',{level:3}],['- ','bulletListItem',{}],['1. ','numberedListItem',{}],['[] ','checkListItem',{checked:false}],['[x] ','checkListItem',{checked:true}],['> ','quote',{}]]){
  const editor=BlockNoteEditor.create({schema,initialContent:[{id:'typed',type:'paragraph'}]})
  const host=document.createElement('div');document.body.append(host);editor.mount(host)
  try{
   editor.setTextCursorPosition('typed','start');typeThroughInputRules(editor,prefix)
   assert.equal(editor.getBlock('typed').type,type,prefix)
   for(const [name,value] of Object.entries(props))assert.equal(editor.getBlock('typed').props[name],value,prefix)
   typeThroughInputRules(editor,'Typed content');assert.equal(editor.getBlock('typed').content[0].text,'Typed content')
  }finally{editor.unmount();host.remove()}
 }
})

test('clipboard paste links selected text; internal page links survive HTML export and paste',async()=>{
 const {editorLinks}=await import('../src/components/page/links.ts')
 const {TextSelection}=await import('@tiptap/pm/state')
 const {Slice,Fragment}=await import('@tiptap/pm/model')
 const editor=BlockNoteEditor.create({schema,links:editorLinks,initialContent:[{id:'paste',type:'paragraph',content:'Selected words'}]})
 const host=document.createElement('div');document.body.append(host);editor.mount(host)
 try{
  const view=editor.prosemirrorView;let start
  view.state.doc.descendants((node,pos)=>{if(node.isText&&node.text==='Selected words')start=pos})
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,start,start+14)))
  const slice=new Slice(Fragment.from(view.state.schema.text('https://example.com')),0,0)
  assert.ok(view.someProp('handlePaste',handler=>handler(view,new dom.window.Event('paste'),slice)))
  assert.equal(editor.getBlock('paste').content[0].type,'link');assert.equal(editor.getBlock('paste').content[0].href,'https://example.com')
  assert.equal(editor.getBlock('paste').content[0].content[0].text,'Selected words')
  const local="workspace://page/01234567-1234-1234-1234-0123456789ab"
  const html=editor.blocksToHTMLLossy([{id:'link',type:'paragraph',content:[{type:'link',href:local,content:[{type:'text',text:'Local page',styles:{}}]}]}])
  assert.match(html,/workspace:\/\/page\//)
  const reopened=editor.tryParseHTMLToBlocks(html);assert.equal(reopened[0].content[0].href,local)
 }finally{editor.unmount();host.remove()}
})

test('typed inline Markdown produces bold, italic, strike and code marks',()=>{
 for(const [text,style] of [['**bold**','bold'],['*italic*','italic'],['~~struck~~','strike'],['`code`','code']]){
  const editor=BlockNoteEditor.create({schema,initialContent:[{id:'inline',type:'paragraph'}]})
  const host=document.createElement('div');document.body.append(host);editor.mount(host)
  try{
   editor.setTextCursorPosition('inline','start');typeThroughInputRules(editor,text)
   assert.equal(editor.getBlock('inline').content[0].styles[style],true,text)
   assert.equal(editor.getBlock('inline').content[0].text,text.replaceAll(style==='code'?'`':style==='strike'?'~':'*',''))
  }finally{editor.unmount();host.remove()}
 }
})

test('rich HTML enters through the actual ProseMirror paste pipeline and preserves supported marks, lists and links',()=>{
 const editor=BlockNoteEditor.create({schema,initialContent:[{id:'target',type:'paragraph'}]})
 const host=document.createElement('div');document.body.append(host);editor.mount(host)
 try{
  editor.setTextCursorPosition('target','start')
  const html='<h2>Pasted heading</h2><p><strong>Bold</strong> <em>Italic</em> <s>Struck</s> <code>Code</code> <a href="https://example.com/path">Reference</a></p><ul><li>First item</li><li>Second item</li></ul>'
  assert.equal(editor.prosemirrorView.pasteHTML(html,new dom.window.Event('paste')),true)
  const content=editor.document
  assert.equal(content[0].type,'heading');assert.equal(content[0].props.level,2);assert.equal(content[0].content[0].text,'Pasted heading')
  const inline=content.find(block=>block.type==='paragraph').content
  for(const [text,style] of [['Bold','bold'],['Italic','italic'],['Struck','strike'],['Code','code']])assert.equal(inline.find(run=>run.text===text)?.styles[style],true,text)
  assert.equal(inline.find(run=>run.type==='link')?.href,'https://example.com/path')
  assert.deepEqual(content.filter(block=>block.type==='bulletListItem').map(block=>block.content[0].text),['First item','Second item'])
  const persisted=JSON.parse(JSON.stringify(content));assert.deepEqual(JSON.parse(JSON.stringify(BlockNoteEditor.create({schema,initialContent:persisted}).document)),persisted)
 }finally{editor.unmount();host.remove()}
})
