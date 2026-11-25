import { createExtension } from '@blocknote/core'
import { TextSelection } from '@tiptap/pm/state'

const listItemTypes = new Set(['toggleListItem', 'bulletListItem', 'numberedListItem', 'checkListItem'])

/**
 * BlockNote's two-level split puts the child group in the new item. Split only
 * the inline content of a list item with children, then insert its sibling.
 */
export const PreserveListChildrenOnEnter = createExtension(() => ({
  key: 'waynoted-list-enter',
  runsBefore: ['toggle-list-item-shortcuts', 'bullet-list-item-shortcuts', 'numbered-list-item-shortcuts', 'check-list-item-shortcuts'],
  keyboardShortcuts: {
    Enter: ({ editor, event }) => {
      if (!editor.isEditable || event.isComposing) return false
      return editor.transact(tr => {
        const selection = tr.selection
        if (!(selection instanceof TextSelection) || !selection.$from.sameParent(selection.$to)) return false
        const { $from, $to } = selection
        const content = $from.parent
        if ($from.depth < 2 || !listItemTypes.has(content.type.name)) return false
        const containerDepth = $from.depth - 1
        const container = $from.node(containerDepth)
        if (container.type.name !== 'blockContainer' || container.lastChild?.type.name !== 'blockGroup') return false

        if (selection.empty && $from.parentOffset === 0 && content.content.size > 0) {
          // At the start, keep the original title and its children together.
          const before = $from.before(containerDepth)
          const blank = container.type.create({ id: crypto.randomUUID() }, content.type.create())
          tr.insert(before, blank).scrollIntoView()
          return true
        }

        const suffix = content.content.cut($to.parentOffset)
        const newItem = container.type.create({ id: crypto.randomUUID() }, content.type.create(null, suffix))
        const after = $from.after(containerDepth)
        if ($from.pos < $from.end()) tr.delete($from.pos, $from.end())
        const insertion = tr.mapping.map(after)
        tr.insert(insertion, newItem)
        tr.setSelection(TextSelection.create(tr.doc, insertion + 2)).scrollIntoView()
        return true
      })
    },
  },
}))
