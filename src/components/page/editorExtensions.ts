import { SyntaxHighlightingExtension } from '@blocknote/core'

/** Shiki grammars and themes come from the installed package; nothing is fetched. */
export async function createLocalHighlighter() {
      const [{ createBundledHighlighter }, { createJavaScriptRegexEngine }] = await Promise.all([
        import('shiki/core'), import('shiki/engine/javascript'),
      ])
      const createHighlighter = createBundledHighlighter({
        themes: {
          'github-light': () => import('@shikijs/themes/github-light'),
          'github-dark': () => import('@shikijs/themes/github-dark'),
        },
        langs: {
          javascript: () => import('@shikijs/langs/javascript'), typescript: () => import('@shikijs/langs/typescript'),
          jsx: () => import('@shikijs/langs/jsx'), tsx: () => import('@shikijs/langs/tsx'),
          json: () => import('@shikijs/langs/json'), html: () => import('@shikijs/langs/html'), css: () => import('@shikijs/langs/css'),
          bash: () => import('@shikijs/langs/bash'), python: () => import('@shikijs/langs/python'),
          sql: () => import('@shikijs/langs/sql'), markdown: () => import('@shikijs/langs/markdown'),
          yaml: () => import('@shikijs/langs/yaml'), java: () => import('@shikijs/langs/java'),
          rust: () => import('@shikijs/langs/rust'), go: () => import('@shikijs/langs/go'),
          c: () => import('@shikijs/langs/c'), cpp: () => import('@shikijs/langs/cpp'),
        },
        engine: () => createJavaScriptRegexEngine(),
      })
  return createHighlighter({ themes: ['github-light', 'github-dark'], langs: [] })
}

export function editorExtensions() {
  return [SyntaxHighlightingExtension({ createHighlighter: createLocalHighlighter })]
}
