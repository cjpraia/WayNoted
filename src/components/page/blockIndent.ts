import { createExtension, FilePanelExtension, FormattingToolbarExtension, SuggestionMenu } from '@blocknote/core'
import { Plugin, TextSelection } from '@tiptap/pm/state'

const focusedControls = 'input, textarea, select, button, [contenteditable="false"], [role="button"], [role="combobox"]'

export const PreserveSiblingsOnOutdent = createExtension(() => ({
  key: 'waynoted-block-outdent',
  prosemirrorPlugins: [new Plugin({
    props: {
      handleDOMEvents: {
        keydown(view, event) {
          if (event.key !== 'Tab') return false
          if (event.isComposing || event.keyCode === 229) return true
          // Prevent the editor keymaps from editing a block while a child control has focus.
          const control = event.target instanceof Element ? event.target.closest(focusedControls) : null
          return !!control && view.dom.contains(control)
        },
      },
    },
  })],
  keyboardShortcuts: {
    'Shift-Tab': ({ editor, event }) => {
      if (!editor.isEditable || event.defaultPrevented || event.isComposing) return false
      if (editor.getExtension(SuggestionMenu)?.shown() ||
          editor.getExtension(FormattingToolbarExtension)?.store.state ||
          editor.getExtension(FilePanelExtension)?.store.state !== undefined) return false

      return editor.transact(tr => {
        const selection = tr.selection
        if (!(selection instanceof TextSelection)) return false
        const { $from, $to } = selection
        if ($from.depth < 4 || $from.depth !== $to.depth) return false
        if (editor.schema.blockSpecs[$from.parent.type.name]?.config.content !== 'inline' ||
            editor.schema.blockSpecs[$to.parent.type.name]?.config.content !== 'inline') return false

        const blockDepth = $from.depth - 1
        const groupDepth = blockDepth - 1
        const parentDepth = groupDepth - 1
        const group = $from.node(groupDepth)
        if ($from.node(blockDepth).type.name !== 'blockContainer' ||
            $to.node(blockDepth).type.name !== 'blockContainer' ||
            $from.start(groupDepth) !== $to.start(groupDepth) ||
            group.type.name !== 'blockGroup' ||
            $from.node(parentDepth).type.name !== 'blockContainer') return false

        const start = $from.before(blockDepth)
        const end = $to.after(blockDepth)
        const blocks = tr.doc.slice(start, end).content
        const parentEnd = $from.after(parentDepth)
        const { storedMarks } = tr
        // Lift just the selected subtrees. BlockNote's default lift adopts the
        // younger siblings of the selection into the last moved block.
        if (blocks.childCount === group.childCount) tr.delete($from.before(groupDepth), $from.after(groupDepth))
        else tr.delete(start, end)
        const insert = tr.mapping.map(parentEnd)
        tr.insert(insert, blocks)
        tr.setSelection(TextSelection.create(tr.doc, insert + selection.anchor - start, insert + selection.head - start))
        if (storedMarks) tr.setStoredMarks(storedMarks)
        tr.scrollIntoView()
        return true
      })
    },
  },
}))
