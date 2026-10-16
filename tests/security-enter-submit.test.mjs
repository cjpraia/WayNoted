import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Regression: a disabled <input> drops focus, so after a wrong password Enter went nowhere.
// Password fields must stay focusable while a request is in flight (readOnly) and be refocused after an error.
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('unlock forms are real <form onSubmit> and never disable their inputs while busy', async () => {
  for (const path of ['src/security/PageLockGate.tsx', 'src/components/modals/UnlockScreen.tsx', 'src/security/PageLockDialog.tsx', 'src/security/SecuritySettings.tsx']) {
    const source = await read(path)
    assert.ok(/<form[^>]*onSubmit=/.test(source), `${path} uses a form with onSubmit`)
    const disabledInputs = source.split('\n').filter(line => /<input[^>]*(sec-input|st-input)[^>]*disabled=\{busy\}/.test(line))
    assert.ok(disabledInputs.length === 0, `${path} must use readOnly={busy} on inputs, not disabled`)
  }
  for (const path of ['src/security/PageLockGate.tsx', 'src/components/modals/UnlockScreen.tsx']) {
    assert.ok(/input\.current\?\.focus\(\)/.test(await read(path)), `${path} refocuses the field after an error`)
  }
})

test('submit buttons stay enabled after a validation error so Enter can retry', async () => {
  assert.ok(!/!!problem && submitted/.test(await read('src/security/PageLockDialog.tsx')))
  assert.ok(!/submitted && !!problem/.test(await read('src/security/SecuritySettings.tsx')))
})
