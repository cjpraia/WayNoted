const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const {createRequire} = require('node:module')
const {pathToFileURL} = require('node:url')

function harness() {
 const filename=path.resolve('electron/main.cjs'), ownRequire=createRequire(filename), handlers=new Map(), events=new Map(), sent=[]
 const electron={app:{setName(){},setPath(){},getPath:()=>"/tmp/workspace-test-appdata",requestSingleInstanceLock:()=>true,quit(){},on(){},whenReady:()=>new Promise(()=>{})},ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on:(name,fn)=>events.set(name,fn)},BrowserWindow:{},Menu:{},shell:{},dialog:{},nativeTheme:{},screen:{},Notification:{},safeStorage:{}}
 const context={require:name=>name==='electron'?electron:ownRequire(name),module:{exports:{}},exports:{},__dirname:path.dirname(filename),process:{env:{},argv:[],platform:'darwin'},console,Buffer,Uint8Array,AbortController,setTimeout,clearTimeout,setInterval,clearInterval,URL}
 vm.runInNewContext(fs.readFileSync(filename,'utf8')+'\nmodule.exports.__test={registerIpc,flushRenderer};',context,{filename})
 context.module.exports.__test.registerIpc()
 const frame={url:pathToFileURL(path.resolve('dist/index.html')).href}
 const sender={id:41,mainFrame:frame,send:(...args)=>sent.push(args)}
 return {handlers,events,sent,sender,frame,api:context.module.exports.__test}
}

test('every preload invoke has a main-process handler and every handler rejects untrusted frames before side effects',()=>{
 const h=harness(),preload=fs.readFileSync('electron/preload.cjs','utf8')
 const channels=[...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map(match=>match[1])
 for(const channel of channels){
  assert.ok(h.handlers.has(channel),channel)
  assert.throws(()=>h.handlers.get(channel)({sender:h.sender,senderFrame:{url:'https://untrusted.example'}},null),/Origem de dados inválida/,channel)
  assert.throws(()=>h.handlers.get(channel)({sender:h.sender,senderFrame:{url:h.frame.url}},null),/Origem de dados inválida/,`${channel}: iframe with same URL`)
 }
})

test('native close handshake accepts only the matching top-level renderer and propagates persistence failure',async()=>{
 const h=harness(),event={sender:h.sender,senderFrame:h.frame}
 h.events.get('np:rendererReady')(event)
 const closing=h.api.flushRenderer({webContents:h.sender})
 const rejection=assert.rejects(closing,/synthetic disk failure/)
 assert.equal(h.sent[0][0],'np:beforeClose')
 const token=h.sent[0][1]
 let settled=false;closing.then(()=>settled=true,()=>settled=true)
 h.events.get('np:closeResult')({sender:{...h.sender,id:99},senderFrame:h.frame},token,null)
 h.events.get('np:closeResult')({sender:h.sender,senderFrame:{url:h.frame.url}},token,null)
 await Promise.resolve();assert.equal(settled,false)
 h.events.get('np:closeResult')(event,token,'synthetic disk failure')
 await rejection
})

test("rota da coleção de tipo: link workspace://type/<id>, janela nova e busca do espaço que tem o tipo",()=>{
 const {randomUUID}=require('node:crypto'),{parseDeepLink,sanitizeWindowRoute,metaHasObjectType}=require('../electron/deep-links.cjs')
 const id=randomUUID()
 assert.deepEqual(parseDeepLink(`workspace://type/${id}`),{type:'objectType',id})
 for(const url of ["workspace://type","workspace://type/abc",`workspace://type/${id}/x`,`workspace://type/${id}?a=1`,`workspace://type/${id}#x`,`workspace://u@type/${id}`])assert.equal(parseDeepLink(url),null,url)
 assert.deepEqual(sanitizeWindowRoute({type:'objectType',id}),{type:'objectType',id})
 assert.deepEqual(sanitizeWindowRoute({type:'objectType',id:'../x'}),{type:'home'},'id inválido volta ao Meu dia')
 assert.deepEqual(sanitizeWindowRoute({type:'tasks',extra:1}),{type:'tasks'})
 assert.deepEqual(sanitizeWindowRoute({type:'page',id}),{type:'page',id})
 assert.deepEqual(sanitizeWindowRoute(null),{type:'home'})
 assert.equal(metaHasObjectType({settings:{objectTypes:[{id}]}},id),true)
 assert.equal(metaHasObjectType({settings:{objectTypes:[{id:'outro'}]}},id),false)
 assert.equal(metaHasObjectType({settings:{}},id),false)
 const main=fs.readFileSync('electron/main.cjs','utf8')
 assert.ok(/sanitizeWindowRoute\(route\)/.test(main)&&/route\.type === 'objectType'/.test(main),'main.cjs usa as rotas de tipo')
})

test('backup externo: todos os IPC np:backup* passam por trustedHandler e o agendador chama o backup verificado',()=>{
 const h=harness(),preload=fs.readFileSync('electron/preload.cjs','utf8')
 const channels=[...preload.matchAll(/ipcRenderer\.invoke\('(np:backup[^']*)'/g)].map(match=>match[1])
 assert.deepEqual(channels.sort(),['np:backupChooseFolder','np:backupDescribe','np:backupList','np:backupNow','np:backupRestore','np:backupRevealFolder','np:backupSettings','np:backupSettingsSet'])
 for(const channel of channels){
  assert.ok(h.handlers.has(channel),channel)
  assert.throws(()=>h.handlers.get(channel)({sender:h.sender,senderFrame:{url:'https://untrusted.example'}},null),/Origem de dados inválida/,channel)
 }
 const main=fs.readFileSync('electron/main.cjs','utf8'),ipc=fs.readFileSync('electron/backup-ipc.cjs','utf8')
 assert.ok(/backupService\?\.autoBackup\(workspace\.id\)/.test(main),'agendador chama autoBackup')
 assert.ok(!/ipcMain\./.test(ipc),'backup-ipc.cjs só usa trustedHandler')
 assert.ok(/assertOutsideData/.test(ipc),'pasta validada fora dos dados')
})

test('espelho Markdown (D1): todos os IPC np:mirror* passam por trustedHandler; o módulo nunca lê o espelho de volta',()=>{
 const h=harness(),preload=fs.readFileSync('electron/preload.cjs','utf8')
 const channels=[...preload.matchAll(/ipcRenderer\.invoke\('(np:mirror[^']*)'/g)].map(match=>match[1])
 assert.deepEqual(channels.sort(),['np:mirrorApply','np:mirrorChooseFolder','np:mirrorRemove','np:mirrorReveal','np:mirrorSettings','np:mirrorSettingsSet','np:mirrorSyncState'])
 for(const channel of channels){
  assert.ok(h.handlers.has(channel),channel)
  assert.throws(()=>h.handlers.get(channel)({sender:h.sender,senderFrame:{url:'https://untrusted.example'}},null),/Origem de dados inválida/,channel)
 }
 const ipc=fs.readFileSync('electron/mirror-ipc.cjs','utf8'),core=fs.readFileSync('electron/mirror.cjs','utf8')
 assert.ok(!/ipcMain\./.test(ipc),'mirror-ipc.cjs só usa trustedHandler')
 assert.ok(/assertMirrorDirectory/.test(ipc)&&/MIRROR_OFF/.test(ipc),'pasta validada e gravação recusada com o espelho desligado')
 assert.ok(!/readFile\(file|readFile\(item/.test(core),'o espelho não lê de volta os arquivos gerados')
})

test('agentes (A1/A2): todos os IPC np:agent* passam por trustedHandler, o conector só copia e o link no PATH pede confirmação',()=>{
 const h=harness(),preload=fs.readFileSync('electron/preload.cjs','utf8')
 const channels=[...preload.matchAll(/ipcRenderer\.invoke\('(np:agent[^']*)'/g)].map(match=>match[1])
 assert.deepEqual(channels.sort(),['np:agentConnector','np:agentCreateClient','np:agentDecide','np:agentInstallCli','np:agentLog','np:agentLogClear','np:agentOverview','np:agentPending','np:agentRevokeClient','np:agentRevokeGrant','np:agentUninstallCli','np:agentUpdateClient','np:agentUpdateSettings'])
 for(const channel of channels){
  assert.ok(h.handlers.has(channel),channel)
  assert.throws(()=>h.handlers.get(channel)({sender:h.sender,senderFrame:{url:'https://untrusted.example'}},null),/Origem de dados inválida/,channel)
  assert.throws(()=>h.handlers.get(channel)({sender:h.sender,senderFrame:{url:h.frame.url}},null),/Origem de dados inválida/,`${channel}: iframe com a mesma URL`)
 }
 assert.ok(/ipcRenderer\.on\('np:agentEvent'/.test(preload),'eventos de aprovação chegam ao renderer')
 const ipc=fs.readFileSync('electron/agent-ipc.cjs','utf8'),main=fs.readFileSync('electron/main.cjs','utf8')
 assert.ok(!/ipcMain\./.test(ipc),'agent-ipc.cjs só usa trustedHandler')
 const install=ipc.slice(ipc.indexOf("'np:agentInstallCli'"),ipc.indexOf("'np:agentUninstallCli'"))
 assert.ok(install.indexOf('showMessageBox')>-1&&install.indexOf('showMessageBox')<install.indexOf('installCli('),'link simbólico só depois da confirmação do usuário')
 assert.ok(/startLocalApi\(\{[^}]*access/.test(main)&&/adoptLegacyToken/.test(main),'a API local usa os clientes com escopo e migra o token antigo')
 assert.ok(/aiPrivate === true/.test(fs.readFileSync('electron/ai/service.cjs','utf8')),'IA em nuvem respeita "Privado para IA"')
})

test('F7: atualizações só por IPC explícito (trustedHandler), sem verificação ao iniciar nem URL embutida',()=>{
 const h=harness(),main=fs.readFileSync('electron/main.cjs','utf8'),preload=fs.readFileSync('electron/preload.cjs','utf8'),update=fs.readFileSync('electron/update-check.cjs','utf8')
 for(const channel of['np:checkForUpdates','np:openUpdatePage']){
  assert.ok(h.handlers.has(channel),channel)
  assert.ok(preload.includes(`ipcRenderer.invoke('${channel}'`),channel)
  assert.throws(()=>h.handlers.get(channel)({sender:h.sender,senderFrame:{url:'https://untrusted.example'}},'https://example.com/f.json'),/Origem de dados inválida/,channel)
 }
 assert.ok(!/checkForUpdates\(/.test(main.replace(/registerUpdateCheck[^\n]*/,'')),'main.cjs nunca chama a verificação sozinho')
 assert.ok(!/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(update.replace(/\/\/.*$/gm,'').replace(/https:\/\/exemplo/g,'')),'update-check.cjs não embute nenhum endereço')
 assert.ok(!/autoUpdater|setInterval|setTimeout\(\s*check/.test(update),'sem atualização automática nem agendamento')
})

test('Onda 3a (B5, B1, D3b): canais de arquivo avulso, pareamento do clipper e Apple Notes existem no preload e rejeitam quadros não confiáveis',()=>{
 const h=harness(),preload=fs.readFileSync('electron/preload.cjs','utf8')
 const channels=['np:openMarkdownFile','np:externalFileCheck','np:externalFileReload','np:externalFileSave','np:externalFileRelease','np:clipperPairStart','np:clipperPairCancel','np:appleNotesFolders','np:appleNotesBatch','np:appleNotesCancel']
 for(const channel of channels){
  assert.ok(preload.includes(`ipcRenderer.invoke('${channel}'`),`preload ${channel}`)
  assert.ok(h.handlers.has(channel),`handler ${channel}`)
  assert.throws(()=>h.handlers.get(channel)({sender:h.sender,senderFrame:{url:'https://untrusted.example'}},null),/Origem de dados inválida/,channel)
  assert.throws(()=>h.handlers.get(channel)({sender:h.sender,senderFrame:{url:h.frame.url}},null),/Origem de dados inválida/,`${channel}: iframe com a mesma URL`)
 }
 const main=fs.readFileSync('electron/main.cjs','utf8')
 assert.ok(/np:externalFileReady/.test(main)&&/np:externalFileReady/.test(preload),'entrega de arquivos só depois de o renderer estar pronto')
 assert.ok(/sendCommand\('open-markdown-file'\)/.test(main)&&/sendCommand\('import-apple-notes'\)/.test(main),'itens de menu')
})

test('Onda 3b (C3b): canais de Lembretes passam por trustedHandler, a permissão só é pedida no comando explícito e o helper está no build',()=>{
 const h=harness(),preload=fs.readFileSync('electron/preload.cjs','utf8')
 const channels=[...preload.matchAll(/ipcRenderer\.invoke\('(np:reminders[^']*)'/g)].map(match=>match[1])
 assert.deepEqual(channels.sort(),['np:remindersComplete','np:remindersDelete','np:remindersEnsureList','np:remindersList','np:remindersRequestAccess','np:remindersStatus','np:remindersUpsert'])
 for(const channel of channels){
  assert.ok(h.handlers.has(channel),`handler ${channel}`)
  assert.throws(()=>h.handlers.get(channel)({sender:h.sender,senderFrame:{url:'https://untrusted.example'}},null),/Origem de dados inválida/,channel)
  assert.throws(()=>h.handlers.get(channel)({sender:h.sender,senderFrame:{url:h.frame.url}},null),/Origem de dados inválida/,`${channel}: iframe com a mesma URL`)
 }
 const service=fs.readFileSync('electron/apple-reminders.cjs','utf8'),swift=fs.readFileSync('native/Reminders.swift','utf8'),build=fs.readFileSync('build/build-native.mjs','utf8')
 assert.ok(!/ipcMain\./.test(service),'apple-reminders.cjs só usa trustedHandler')
 const request=swift.slice(swift.indexOf('case "request"'),swift.indexOf('case "lists"'))
 assert.ok(/requestFullAccessToReminders/.test(request)&&!/requestFullAccessToReminders|requestAccess\(to: \.reminder\)/.test(swift.replace(request,'')),'o pedido ao macOS está só em `reminders request`')
 assert.ok(/case "reminders": runReminders/.test(fs.readFileSync('native/main.swift','utf8'))&&build.includes("'Reminders.swift'"),'comando e arquivo no build do helper')
 const plist=fs.readFileSync('native/Info.plist','utf8')
 assert.ok(plist.includes('NSRemindersFullAccessUsageDescription')&&plist.includes('NSRemindersUsageDescription'),'textos de permissão do helper')
 assert.ok(require('../electron/native-helper.cjs').PRIVACY_PANES.reminders.endsWith('Privacy_Reminders'),'painel de Privacidade → Lembretes')
 assert.ok(/openPrivacySettings\?\.\('reminders'\)/.test(fs.readFileSync('src/reminders/RemindersUi.tsx','utf8')),'a interface abre o painel certo')
})

test('Nota rápida (⌥⌘N): ditado por IPC mínimo, só da janela rápida validada; painéis de permissão em lista fechada',()=>{
 const preload=fs.readFileSync('electron/quick-preload.cjs','utf8'),source=fs.readFileSync('electron/quick-capture.cjs','utf8'),main=fs.readFileSync('electron/main.cjs','utf8')
 const channels=['npq:dictationStart','npq:dictationStop','npq:dictationCancel','npq:openPrivacySettings']
 for(const channel of channels){
  assert.ok(preload.includes(`ipcRenderer.invoke('${channel}'`),`quick-preload ${channel}`)
  assert.ok(source.includes(`handle('${channel}'`),`handler ${channel} passa por handle() (valida remetente e quadro)`)
 }
 assert.ok(preload.includes("ipcRenderer.on('npq:dictationEvent'")&&!/np:dictation/.test(preload),'eventos só no canal da janela rápida; nenhum canal do app principal')
 assert.ok(!/ipcRenderer\.send|shell|require\('fs'\)/.test(preload),'a ponte rápida continua mínima')
 assert.ok(/dictation: dictationService/.test(main)&&/registerDictationIpc\(trustedHandler, dictationService\)/.test(main),'um só serviço de ditado compartilhado')
 assert.ok(/\['microphone', 'speech', 'dictation'\]/.test(source),'só os painéis do ditado')
 assert.ok(/cancelDictation\(\); win\.hide\(\)/.test(source),'ocultar a janela encerra o ditado')
 const { openPrivacyPane }=require('../electron/native-helper.cjs'),opened=[]
 openPrivacyPane('microphone',url=>opened.push(url),['microphone','speech','dictation'])
 assert.equal(opened.length,1)
 assert.throws(()=>openPrivacyPane('calendars',url=>opened.push(url),['microphone','speech','dictation']),/Painel inválido/)
 assert.throws(()=>openPrivacyPane('__proto__',url=>opened.push(url)),/Painel inválido/)
 assert.equal(opened.length,1)
 // Remetente fora da janela rápida: rejeitado antes de qualquer ação.
 const Module=require('node:module'),handlers=new Map(),load=Module._load
 Module._load=function(request,...rest){return request==='electron'?{ipcMain:{handle:(channel,fn)=>handlers.set(channel,fn)},app:{},screen:{}}:load.call(this,request,...rest)}
 try{
  const file=require.resolve('../electron/quick-capture.cjs');delete require.cache[file]
  const quick=require(file).createQuickCapture({userData:()=>'/nonexistent',isDev:false,distDir:'/nonexistent',quitting:()=>false,dictation:{start(){throw new Error('não deveria iniciar')},stop(){},cancel(){}}})
  quick.registerIpc()
  for(const channel of channels)assert.throws(()=>handlers.get(channel)({sender:{},senderFrame:{url:'https://untrusted.example'}},{locale:'pt-BR'}),/Origem de dados inválida/,channel)
 }finally{Module._load=load;delete require.cache[require.resolve('../electron/quick-capture.cjs')]}
})

test('third-party notices IPC uses trustedHandler and a fixed path (no renderer-supplied path)',async()=>{
 const h=harness(),fsp=require('node:fs')
 assert.ok(h.handlers.has('np:readThirdPartyNotices')&&h.handlers.has('np:revealThirdPartyNotices'))
 const source=fs.readFileSync('electron/notices-ipc.cjs','utf8')
 assert.ok(/trustedHandler\('np:readThirdPartyNotices', async \(\) =>/.test(source),'no handler argument is accepted')
 assert.ok(/trustedHandler\('np:revealThirdPartyNotices', async \(\) =>/.test(source))
 assert.ok(/path\.join\(root \?\? app\.getAppPath\(\), FILE_NAME\)/.test(source))
 const preload=fs.readFileSync('electron/preload.cjs','utf8')
 assert.ok(/readThirdPartyNotices: \(\) => ipcRenderer/.test(preload)&&/revealThirdPartyNotices: \(\) => ipcRenderer/.test(preload),'preload forwards no arguments')
 const {registerNoticesIpc}=require('../electron/notices-ipc.cjs'),reg=new Map(),shown=[]
 registerNoticesIpc({trustedHandler:(c,fn)=>reg.set(c,fn),app:{getVersion:()=>'9.9.9',getAppPath:()=>path.resolve('.')},shell:{showItemInFolder:p=>shown.push(p)}})
 const read=await reg.get('np:readThirdPartyNotices')({},'/etc/passwd')
 assert.equal(read.version,'9.9.9')
 assert.equal(read.found,fsp.existsSync('THIRD-PARTY-NOTICES.md'))
 if(read.found){assert.ok(read.text.includes('Packages:'));await reg.get('np:revealThirdPartyNotices')({},'/etc/passwd');assert.equal(shown[0],path.resolve('THIRD-PARTY-NOTICES.md'))}
 const missing=new Map();registerNoticesIpc({trustedHandler:(c,fn)=>missing.set(c,fn),app:{getVersion:()=>'1',getAppPath:()=>'/nonexistent-np'},shell:{}})
 assert.equal((await missing.get('np:readThirdPartyNotices')({})).found,false)
})
