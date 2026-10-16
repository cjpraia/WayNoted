const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { createOcr, decodeImage } = require('../electron/ocr.cjs')

const png = 'data:image/png;base64,' + Buffer.from('fake').toString('base64')

test('OCR valida a imagem e recusa formatos e tamanhos inválidos', () => {
  assert.equal(decodeImage(png).extension, 'png')
  assert.throws(() => decodeImage('data:text/plain;base64,AA=='), /inválida/)
  assert.throws(() => decodeImage('https://example.com/a.png'), /inválida/)
  assert.throws(() => decodeImage('data:image/svg+xml;base64,AA=='), /sem suporte/)
})

test('OCR roda osascript com o script Vision local e apaga o arquivo temporário', async () => {
  let seenFile = ''
  const ocr = createOcr({ platform: 'darwin', run: (command, args, _options, callback) => {
    assert.equal(command, 'osascript'); assert.deepEqual(args.slice(0, 2), ['-l', 'JavaScript'])
    assert.ok(args[2].endsWith('ocr-vision.js')); seenFile = args[3]
    assert.equal(fs.readFileSync(seenFile, 'utf8'), 'fake')
    callback(null, 'Contrato de locação\n')
  } })
  const result = await ocr.recognize(png)
  assert.equal(result.ok, true); assert.equal(result.text, 'Contrato de locação')
  assert.equal(fs.existsSync(seenFile), false)
})

test('OCR indisponível fora do macOS e falhas viram resultado vazio', async () => {
  assert.equal((await createOcr({ platform: 'linux' }).recognize(png)).ok, false)
  const failing = createOcr({ platform: 'darwin', run: (_c, _a, _o, callback) => callback(Object.assign(new Error('x'), { killed: true })) })
  const result = await failing.recognize(png)
  assert.equal(result.ok, false); assert.equal(result.reason, 'timeout')
})

test('OCR com o script dentro de um .asar copia-o para a pasta temporária (osascript não lê asar)', async () => {
  const os = require('node:os'), path = require('node:path')
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'np-asar-test-'))
  const fake = path.join(base, 'app.asar'); fs.mkdirSync(fake)   // pasta que se chama .asar: o caminho tem o mesmo formato do app empacotado
  fs.writeFileSync(path.join(fake, 'ocr-vision.js'), '// jxa')
  let usedScript = '', copied = ''
  const ocr = createOcr({ platform: 'darwin', script: path.join(fake, 'ocr-vision.js'), run: (_c, args, _o, callback) => { usedScript = args[2]; copied = fs.readFileSync(args[2], 'utf8'); callback(null, 'ok') } })
  const result = await ocr.recognize(png)
  fs.rmSync(base, { recursive: true, force: true })
  assert.equal(result.ok, true)
  assert.ok(!usedScript.includes('.asar'), 'o osascript recebeu um caminho dentro do asar: ' + usedScript)
  assert.equal(copied, '// jxa'); assert.equal(fs.existsSync(usedScript), false)
})
