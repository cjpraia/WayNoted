import { defaultStyleSpecs } from '@blocknote/core'

// Keep the default Code mark's shortcuts and parser, but allow it to coexist
// with emphasis, underline, and color during HTML import/export.
const inclusiveCodeStyle: typeof defaultStyleSpecs.code = {
  ...defaultStyleSpecs.code,
  implementation: {
    ...defaultStyleSpecs.code.implementation,
    mark: defaultStyleSpecs.code.implementation.mark.extend({ excludes: '' }),
  },
}

export const editorStyleSpecs = { ...defaultStyleSpecs, code: inclusiveCodeStyle }
