# WayNoted keyboard shortcuts

On macOS, ⌘ means Command, ⌥ Option, ⇧ Shift, and ⌃ Control. In browser development mode on other platforms, Ctrl replaces ⌘.

App-level shortcuts are defined in `src/shortcuts.ts`, window handlers in `src/App.tsx`, and native menu accelerators in `electron/main.cjs`. Editor, canvas, and database shortcuts depend on focus. Global shortcuts work while the app is in the background.

## Navigation and windows

| Shortcut | Action |
|---|---|
| ⌘K | Toggle search and commands |
| ⌘P | Search alias; does not print |
| ⌘N | New page |
| ⌘⇧N | New window at the current route, with one tab and independent tab state |
| ⌘T | New tab |
| ⌘⇧T | Reopen the last closed tab; up to 30 are retained |
| ⌘W | Close the current tab |
| ⌘⇧W | Close the window |
| ⌃Tab / ⌃⇧Tab | Next / previous tab |
| ⌘[ / ⌘] | Back / forward in the tab's history |
| ⌘\ | Toggle sidebar; closes an open row preview first |
| ⌘, | Settings |
| ⌘G | Toggle page graph; with multiple canvas objects selected, group them instead |
| ⌘⇧D | Today's daily note |
| ⌘⇧C | Toggle calendar panel |
| ⌘⇧P | Toggle productivity panel |
| ⌘J | Toggle Ask your notes |
| ⌘⇧F | Focus mode; Esc exits |
| ⌘⇧E | Export |
| ⌘R | Save, then reload the window |
| ⌘+ / ⌘− / ⌘0 | Zoom in / out / actual size |
| ⌃⌘F | Full screen |
| ⌘M / ⌘H / ⌘Q | Minimize / hide / quit |

Yesterday/tomorrow's notes, Tasks, New canvas, package import, and Open data folder are available through menus, the sidebar, or ⌘K without dedicated shortcuts. System links such as `workspace://home`, `workspace://tasks`, and `workspace://daily/YYYY-MM-DD` open the same screens from outside the app; see [Local integrations](LOCAL-INTEGRATIONS.md).

## Quick capture: global shortcuts

| Shortcut | Action |
|---|---|
| ⌥⌘N | Toggle quick note; configurable in Settings → Quick capture |
| ⌥⇧⌘N | Capture selection/clipboard; configurable |
| ⌘Enter | Save, inside the quick-note window |

Global shortcuts must differ and include a modifier other than Shift. If another app owns a shortcut, settings reports it as unavailable. The native menu displays the configured shortcut without registering it twice.

## Page editor

| Shortcut | Action |
|---|---|
| `/` | Open block commands |
| `@` | Mention a page or date |
| ⌘F | Find/replace in the page |
| ⌘⇧V | Paste plain text; normal paste converts Markdown/HTML |
| ⌘Z / ⌘⇧Z, also ⌘Y | Undo / redo; formatted paste undoes in one step |
| ⌘⇧M | Comment on the selection |
| ⌘D | Duplicate the block at the cursor |
| ⌘⌥K | Insert a live query below the current block |
| ⌘⌥Q | Convert to quote |
| ⌘B / ⌘I / ⌘U / ⌘E | Bold / italic / underline / inline code |
| ⌘⌥0 / ⌘⌥1–3 | Paragraph / heading 1–3 |
| ⌘⇧6 through ⌘⇧9 | List conversions: task, numbered, bulleted, toggle |
| ⌘⌥C | Code block |
| Tab / ⇧Tab | Indent / outdent |
| Esc | Exit focus mode or dismiss menus/side preview |

Formatting and conversion shortcuts include BlockNote 0.55 defaults inspected in library code. They have not all been checked on a physical keyboard in the packaged app; the exact ⌘⇧6–9 mapping still needs individual verification.

## Canvas

These shortcuts apply while the canvas has focus, except when typing in a text field or page card. See `CanvasBoard.tsx:onKeyDown` and `tools.ts:TOOL_KEYS`.

| Shortcut | Action |
|---|---|
| V / Q / H | Select / freehand lasso / hand |
| N / T / F, also S | Note / text / section frame |
| R / O / D | Rectangle / ellipse / diamond |
| L / A | Line / arrow connector |
| P / E / I | Pen / eraser / image |
| 1–9, 0 | Select, rectangle, diamond, ellipse, arrow, line, pen, text, image, eraser |
| Space + drag | Pan |
| ⌘ + wheel, pinch | Zoom around the cursor |
| + / − / ⇧0 | Zoom in / out / 100%; also works with ⌘ |
| ⇧1 / ⇧2 | Fit all / selection |
| ⇧ or ⌥ + drag a handle | Resize proportionally / from center |
| Arrow keys | Move selection 1 px; ⇧ moves 10 px |
| ⌘A | Select all |
| ⌘D or ⌥-drag | Duplicate |
| ⌘G / ⌘⇧G | Group / ungroup |
| ⌘L | Lock / unlock |
| ⌘] / ⌘[ | Bring forward / send backward; ⇧ or ⌥ moves to front/back; plain brackets also work |
| ⌥→ / ⌥← | Navigate sections for presentation |
| ⌘F | Search objects; Enter advances |
| Enter / double-click | Edit text or open a page card |
| Esc | Return to Select, then clear selection; Esc or ⌘Enter finishes text editing |
| Delete / Backspace | Delete selection |
| ⌘Z / ⌘⇧Z, also ⌘Y | Undo / redo, up to 200 steps |
| ⌘C / ⌘X / ⌘V | Copy / cut / paste objects, including between canvases |

On a read-only canvas, editing shortcuts are disabled; selection, hand, zoom, select all, search, and navigation remain available. Physical-keyboard verification in the packaged app is still needed.

## Search: ⌘K

| Shortcut | Action |
|---|---|
| ↑ / ↓ | Navigate results |
| Enter | Open |
| ⌘Enter | Open in a new tab |
| Esc | Close |

Search also supports exact phrases (`"exact phrase"`), exclusions (`-exclude`), and object-type filters (`type:Book`).

## Database cells: inline text editing

Clicking a title, text, number, URL, email, or phone cell opens an editor over that cell, preserving its width and typography and growing downward. Rich-text controls appear on demand.

| Shortcut | Action |
|---|---|
| Enter / ⌘Enter / ⌥Enter | Commit |
| ⇧Enter | Line break in a Text property |
| Esc | Cancel and restore the previous value |
| Tab / ⇧Tab | Commit and edit the next / previous editable cell |
| ⌘B / ⌘I / ⌘U | Bold / italic / underline selected text |
| ⌘⇧S / ⌘E | Strikethrough / inline code |
| ⌘K | Edit the selection's link or the link under the cursor; Enter applies, Esc closes, empty removes. Global search is suppressed here |
| ⌘⇧V | Paste plain text; normal paste preserves supported inline HTML/Markdown formatting |
| ⌘Z / ⌘⇧Z | Native editing undo / redo; each formatting operation is a step |

Relevant code: `RichTextEditor.tsx`, `TextEditor.tsx`, and `TableView.tsx:onEditorClose`.

## Sidebar: page and subpage selection

| Input | Action |
|---|---|
| ⌘-click | Toggle a page in the selection; use middle-click, ⌘Enter, or the context menu to open a new tab |
| ⇧-click | Select a range of sibling pages; cross-level ranges are rejected with a message |
| Space on a focused page | Toggle selection |
| ⇧↑ / ⇧↓ | Move focus and extend selection |
| Esc | Clear selection |
| Right-click a selected page | Selection menu: create database, move to database, duplicate, favorite, trash |
| Drag a page or selection onto a database | Add as rows |
| Drag onto a type in the Types section | Apply the type |
| ⌥↑ / ⌥↓ in the Subpages section | Reorder a subpage |
| ⌘Z / ⌘⇧Z outside text fields | Undo / redo page/database conversions |

## Databases: row selection and view settings

| Input | Action |
|---|---|
| Click / ⇧-click a row checkbox | Select a row / extend the range |
| ⌘A outside text fields | Select all rows in the filtered table, list, or gallery |
| Esc with selected rows | Clear selection |
| Esc in view settings | Go back one level, or close from the main screen |
| ↑ / ↓ and Enter in settings or the view-tab menu | Navigate and activate items |
| ⌥↑ / ⌥↓ on a property-visibility control | Reorder a property |

## Databases: active table cell and cards

The table shows an active cell with an inset blue border. Keyboard focus stays on the grid using `role="grid"`, `aria-activedescendant`, `aria-selected`, and row/column indices. These shortcuts apply only while the grid itself has focus, not inside editors or popovers. Tab enters at the first cell and leaves after the last.

| Shortcut | Action |
|---|---|
| Arrow keys | Move active cell, scroll into view, cross groups, and skip group headers |
| Home / End | First / last column in the row |
| ⌘↑ / ⌘↓ | First / last loaded row across all groups |
| PageUp / PageDown | Move one viewport |
| Tab / ⇧Tab | Next / previous cell, wrapping across rows |
| Enter / F2 | Edit; toggle checkboxes; open select, status, date, relation, or files popovers; activate button properties |
| Space | Toggle checkbox |
| A printable character | Replace the value and begin editing title, text, number, URL, email, phone, or person; numbers accept digits and `.,+-` |
| Backspace / Delete | Clear the value; undoable in one step |
| ⌘C / ⌘V | Copy cell text / paste, including TSV into existing cells starting at the active cell |
| ⇧↑ / ⇧↓ | Extend row selection |
| ⌘Enter | Open the row as a page |
| Esc | Clear row selection or leave editing, keeping the active cell |
| ⌘Z / ⌘⇧Z outside text fields | Undo / redo database actions |

TSV paste fills downward and rightward, never creates rows, and is limited to 2,000 cells in one undo step. Values that cannot be converted are skipped, with a pasted/skipped count.

For board, gallery, and list cards:

| Input | Action |
|---|---|
| Arrow keys / Home / End | Navigate cards; gallery follows its grid, board skips empty columns and preserves position |
| Enter | Open the focused card |
| Space | Toggle selection |
| F2 or hover rename control | Rename inline; Enter/Esc return focus to the card |
| Double-click a property value | Edit inline; a single click on editable values opens the page after a short delay |

Locked databases/rows and read-only multi-source views allow navigation and opening pages, but not edits, clearing, paste, or renaming. See `tableNav.ts`, `TableView.tsx`, `tests/table-nav.test.mts`, and `tests/table-keyboard-ui.test.mjs`.

## Page previews, comments, and other controls

| Shortcut | Action |
|---|---|
| ⌘\ in a row preview | Close preview |
| ⌘Enter in a row preview | Open as a full page |
| ← / →, Home / End on the preview edge | Resize; Enter on the edge closes it |
| ⌘Enter in comments | Submit comment |
| Enter / ⌘Enter in the sidebar tree | Open page / open in new tab |
| ⌃Space in the query text editor | Suggestions |
| Menu key / ⇧F10 on an app tab | Tab menu: pin, group, duplicate, and other actions |
| Esc in Ask your notes | Stop generation; when idle, close the panel |

## Customization and maintenance

Change available app/menu shortcuts in **Settings → Shortcuts**. Configure global quick-capture shortcuts in their own settings panel. Editor, canvas, and table shortcuts are local to their focused controls.

Settings and the ⌘K shortcut list are generated from `src/shortcuts.ts`, including IDs, English/Portuguese labels, key combinations, and categories. Command hints also use this registry through `shortcutHint`. Add new app shortcuts there and update this guide.

`tests/shortcuts.test.mts` checks native menu `accel` defaults against the registry and verifies handlers for customizable commands in `App.tsx`.

⌘G groups multiple selected canvas objects and otherwise opens the graph. ⌘F searches the active context. Esc dismisses the nearest context, stops generation, or exits the current mode.
