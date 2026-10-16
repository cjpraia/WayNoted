# Usage guide

## Pages and blocks

Create a page from the sidebar or **New page**. Edit its title and add text, headings, lists, tasks, images, files, and other blocks. Type `/` to insert or transform a block. The handle beside a block provides actions, movement, and a link to that block.

Pages can contain subpages, columns, and toggle lists. Internal links use `workspace://`. Open global search with **⌘K**; see [Keyboard shortcuts](KEYBOARD-SHORTCUTS.md) for other commands.

When pasting a URL, the menu offers the representations available for that link: mention, URL, bookmark, or embed. Previews and embedded content depend on the website and remote-content permissions.

## Databases and object types

A database organizes pages as rows with properties. Use column headers and view settings to configure properties, filters, sorting, grouping, text wrapping, and frozen columns. Formulas and rollups are calculated; relations connect database records.

Linked views display the same source with a different presentation. Editing their data changes the shared source. Open a row to edit its page in a resizable preview or as a full page.

Object types add fields and templates to pages without moving them into a database. A type collection gathers pages assigned to that type.

A **Query** block gathers pages and tasks by criteria. See [Live queries](QUERIES.md) for syntax and limitations.

## Daily workflow

A daily note holds content for a date. **Tasks** collects checklist items and dated records; **Productivity** includes activity and spaced review. The sidebar calendar helps navigate dates. Quick capture, macOS Calendar, and Reminders integrations are configurable and require system permissions.

## Canvas and files

The canvas arranges notes, shapes, connectors, images, and page or database cards on a freeform surface. Page cards remain linked to their original content. Export a canvas as PNG, SVG, or PDF.

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
