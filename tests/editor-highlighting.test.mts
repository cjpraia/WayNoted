import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalHighlighter } from '../src/components/page/editorExtensions.ts'

test('local syntax highlighter loads only bundled grammars and highlights JavaScript', async () => {
  const highlighter = await createLocalHighlighter()
  assert.deepEqual(highlighter.getLoadedThemes(), ['github-light', 'github-dark'])
  await highlighter.loadLanguage('javascript')
  const tokens = highlighter.codeToTokens('const answer = 42', { lang: 'javascript', theme: 'github-light' }).tokens.flat()
  assert.ok(tokens.length > 1)
  assert.ok(tokens.some((token) => token.color))
})
