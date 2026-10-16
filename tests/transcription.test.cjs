const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { createTranscriber } = require('../electron/transcription.cjs')
test('transcription uses fixed local executables with argument arrays and removes temporary audio', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-speech-test-")), modelPath = path.join(directory, 'model with spaces.bin')
  await fs.writeFile(modelPath, 'fixture model')
  const commands = []
  const transcribe = createTranscriber({ tempRoot: directory, findExecutable: async name => '/fixed/bin/' + name, run: async (file, args, options) => {
    commands.push({ file, args, options })
    if (file.endsWith('whisper-cli')) await fs.writeFile(args[args.indexOf('-of') + 1] + '.txt', ' Local transcription. ')
  } })
  try {
    const result = await transcribe({ data: new Uint8Array([1, 2, 3]), mimeType: 'audio/webm;codecs=opus', modelPath, language: 'auto' })
    assert.equal(result, 'Local transcription.')
    assert.equal(commands[0].options.shell, false)
    assert.ok(commands[0].args.includes('file,pipe')); assert.ok(commands[0].args.includes('matroska'))
    assert.equal(commands[1].args[commands[1].args.indexOf('-m') + 1], modelPath)
    assert.deepEqual(await fs.readdir(directory), ['model with spaces.bin'])
    await assert.rejects(transcribe({ data: new Uint8Array([1]), mimeType: 'text/html', modelPath, language: 'en' }), /INVALID_INPUT/)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
