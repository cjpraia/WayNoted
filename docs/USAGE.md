# Usage guide

## Pages and blocks

Create a page from the sidebar or **New page**. Edit its title and add text, headings, lists, tasks, images, files, and other blocks. Type `/` to insert or transform a block. The handle beside a block provides actions, movement, and a link to that block.

New pages start at full width. Use **Full width** in the page menu to change it for that page. The trail at the top follows the actual parent pages. Select an ancestor to open it, or use **…** to reach intermediate pages when space is limited.

Use **Copy block** in the block handle menu to copy a block and its children. Paste into WayNoted to retain supported block structure and formatting. Other apps can paste HTML or plain text. A simple table also provides tab-separated values for spreadsheets. Blocks that cannot be copied faithfully, such as live views and local attachment records, are represented as readable text and trigger a notice.

Pages can contain subpages, columns, and toggle lists. Internal links use `workspace://`. Open global search with **⌘K**; see [Keyboard shortcuts](KEYBOARD-SHORTCUTS.md) for other commands.

When pasting a URL, the menu offers the representations available for that link: mention, URL, bookmark, or embed. Previews and embedded content depend on the website and remote-content permissions.

Drag a tab by its title to the left or right side of another tab to reorder it. Pinned tabs keep their pinned status. Tabs in a group can move within that group, and dragging one outside it moves the entire group.

## Library

Open **Library** from the sidebar and search by title or content. Use the **Type** filter to narrow the results. A page with multiple types appears once in the library and can appear under each of its types. Open **Untyped** for regular pages and database rows that have no type. The library opens the original item in its existing location.

The sidebar lists your five most recent pages. Select **View all** to open the full recent history. When you create a page through **New page**, choose its type in the dialog or leave it **Untyped**.

Pages created from the Library, the global **New page** action, or a type collection don't fill up the **Private** tree. Use the **+** in **Private** to create a page there, or use **+** on a page in the tree to create a subpage. Both can have any type or stay untyped. Use **Show in Private** in a top-level page's menu to add it to the tree, or **Move page to** to put it inside another page. Changing a type changes where the page is listed by type, without changing its parent. Private is a sidebar location; it doesn't change access or password protection.

## Databases and object types

A database organizes pages as rows with properties. Use column headers and view settings to configure properties, filters, sorting, grouping, text wrapping, and frozen columns. Formulas and rollups are calculated; relations connect database records.

In a table, right-click a cell to copy it or select it for paste. Use the column header menu to copy the values in the visible rows (or the current group) or select a destination column. Press **⌘V** or **Ctrl+V** to paste. A column paste needs the same number of rows (up to 2,000). When both columns contain the same rows, values follow the rows even if sorted differently. Between non-overlapping sets, values follow the displayed order. A paste can replace existing values, including with blank cells, and can be undone in one step.

WayNoted preserves compatible values within the same open window. Relations must point to the same source, and select options must exist at the destination. Locked or incompatible destinations reject a typed paste or an entire column. The clipboard also contains readable text for other apps, such as relation names rather than links. Copy again if the window has been reloaded.

Linked views display the same source with a different presentation. Editing their data changes the shared source. Open a row to edit its page in a resizable preview or as a full page.

Object types add fields and templates to pages without moving them into a database. A type collection gathers pages assigned to that type.

In **Edit type → Fields → Add field**, choose **Relation to type** and select the target type. For example, a Resource can have separate fields for People, Tags, and Projects. Each field can link multiple existing pages. Enter a new name in the picker to create a page with the target type and link it immediately. Database relations remain available as a separate field choice.

A **Query** block gathers pages and tasks by criteria. See [Live queries](QUERIES.md) for syntax and limitations.

## Daily workflow

A daily note holds content for a date. **Tasks** collects checklist items and dated records; **Productivity** includes activity and spaced review. The sidebar calendar helps navigate dates. Quick capture, macOS Calendar, and Reminders integrations are configurable and require system permissions.

In Quick Capture, use **Type** to classify the new note, or leave it as **No type**. The note is saved to the chosen destination in either case.

## Canvas and files

The canvas arranges notes, shapes, connectors, images, and page or database cards on a freeform surface. Page cards remain linked to their original content. Export a canvas as PNG, SVG, or PDF.

- **Format text.** Select a text box, note, or shape to change its font, size, alignment, emphasis, and text color in the inspector. Text boxes can also have a background color. Use the opacity slider to fade the whole object.
- **Organize with sections.** Draw a section around your content or use **Create section** in the inspector to frame a selection. Double-click the section header to rename it. Drag the header or border to move the section together with its unlocked contents.
- **Build a mind map.** Choose **Mind map** or press **M**, then click the canvas and name the central topic. Select any topic and use a **+** handle to add a connected branch in that direction. To add a branch to the right, press **Alt/Option+Enter**. You can also start with the expandable mind map template.

PDFs support highlights, notes, and drawing. OCR and dictation use local OS capabilities when available. Windows requires installed OCR/speech language support; see [Distribution](DISTRIBUTION.md#windows-native-features).

## Templates

Page, database-row, object-type, and daily-note templates support variables:

| Variable | Purpose |
|---|---|
| `{{date}}`, `{{time}}` | Local date and time |
| `{{date:YYYY-MM-DD}}` | Date in a chosen format |
| `{{date+7d}}`, `{{date-1m}}` | Relative date: days, weeks, months, or years |
| `{{title}}`, `{{user}}` | Page title and configured user name |
| `{{weekday}}`, `{{week}}`, `{{month}}`, `{{year}}` | Date components |
| `{{yesterday}}`, `{{tomorrow}}` | Adjacent dates; links to daily notes in daily-note templates |
| `{{cursor}}` | Initial cursor position |
| `{{ask:Text\|default}}` | Prompt for a value when applying the template |
| `{{prop:Name}}` | Row property, when available in the current context |
| `{{agenda}}`, `{{tasks}}`, `{{query:name}}` | Contextual blocks when used alone in a paragraph |

Portuguese aliases are also supported. Unknown variables remain as text. Automatic creation uses prompt defaults without opening a dialog.

## Import, export, and backup

Import Markdown/CSV or HTML packages, Markdown folders, ENEX, CSV, or notes from the macOS Notes app. Review the preview before importing: calculated fields and external features may become static values or references.

Markdown, HTML, PDF, and CSV exports serve different purposes. Use a workspace backup for full recovery. Exports and portable backups may contain readable text; see [Security](SECURITY.md).

## Appearance and accessibility

The interface supports English and Brazilian Portuguese, light/dark themes, keyboard focus, and system contrast, motion, and transparency preferences. New installations start in English. Change the language in **Settings → My account**, and customize app shortcuts in **Settings → Shortcuts**.

Accessibility coverage is partial. Real VoiceOver validation is still needed: check Tab navigation, dialog opening and dismissal, focus restoration, search, tables, and the editor in both languages. DOM tests do not replace this check.

For AI or agents, see [AI](AI.md) and [Local integrations](LOCAL-INTEGRATIONS.md).

## About

**Settings → About** shows the running version. A verified macOS package also shows the date and time it was built in Brasília time and the short Git hash of the base checkout. When the source matches Git, the description is the latest relevant commit subject. If the build includes local changes, About labels their description as unavailable and separately shows the latest commit subject from the base. The app marks the date or description as unavailable when either cannot be verified. The macOS application menu shows the same details.

### Rebuild and restart from a local checkout

On Apple Silicon, when opened by the project launcher, use **View → Rebuild and restart WayNoted…** to build the files already in that checkout. The build runs in a separate folder while the current app stays open. WayNoted saves the open windows and quick note before starting the new bundle with the same profile. A failed build or save leaves the current app open. Check the local build log shown in the error for details.

The `WayNoted.command` shortcut opens the local checkout or brings its existing window forward. The separate `waynoted-build` executable fetches GitHub's `main` and builds it in a separate checkout. It starts the verified bundle after any existing instance using the same profile closes. Save and quit that instance when prompted so the new version can open. Your branch and local files stay in place.

This option requires Node.js 24+, installed project dependencies and the Xcode Command Line Tools. If the checkout is in Documents, macOS can also require granting WayNoted access to that folder in System Settings. The in-app menu does not fetch updates from Git. The previous app bundle is kept. If the new bundle cannot confirm startup, inspect the log before opening an older bundle, since older versions may not understand data migrated by newer versions.
