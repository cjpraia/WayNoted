# Live queries

A **Query** block lists workspace pages and database rows by criteria and updates when data changes. Use it in any page, including inside toggles, columns, callouts, and daily notes.

## Insert a query

- Open `/` → **Database** → **Query**, or choose a preset: open tasks, pages edited this week, backlinks, or overdue rows.
- In the editor, press **⌘⌥K** to insert below the current block. **⌘⌥Q** is the editor's quote shortcut.
- In **⌘K**, choose **Insert query** or a preset. The block goes at the editor cursor, or at the end of the page when no editor is open.
- In a daily-note template, a paragraph containing only `{{query:tasks_today}}` becomes a query for tasks due **on the note's date**. Presets also support `open_tasks`, `edited_this_week`, `backlinks`, and `overdue_rows`, plus Portuguese aliases.

## Visual builder

The toolbar reads as a sentence: **Show** [Table] **from** [source] **where** [filters] **sort by** … **group by** … **limit** … [Columns].

- Select a filter to choose its field, operator, and value. Select properties offer source database options; dates offer presets such as Today, This week, Next month, Last 7 days, and today + N days.
- Click **AND**/**OR** to switch connectors. **+ Group** creates nested expressions such as `A and (B or C)`. The **not** button before a group negates it; negated groups receive an accent outline.
- **Type** is a page field with is, is not, is any of, is none of, has a type, and has no type operators. The picker shows each type's icon, color, and name. Subtypes count: if Client inherits from Project, “Type is Project” includes Clients. Outside database/task sources, adding a filter starts with Type when types exist.
- **Quick type filters** below the builder show up to six common types and Untyped, with counts. Toggle one or several chips to match any selected type. Counts ignore top-level type filters and the result limit so other choices remain visible. These filters appear only for editable queries with typed pages, outside database/task sources.
- **Type fields** appear in filter, sort, group, and column pickers. When filtering by a type, its fields receive their own section; other types' fields remain available separately. Without selected columns, the table shows Title, Type, and that type's fields. Values come from `typeProps`, or from `props` while an embedded field belongs to a database; a database property with the same name takes priority.
- **Group by Type** creates a group for each type, with a chip and count, largest first and Untyped last. A page with multiple types appears in each group. Sorting by Type uses its name and places untyped pages last.
- **Type and Icon columns** render type chips and actual icons, including emoji, registered line icons, and images.
- **Dates** include Last N days / Next N days and show the resolved range below the filter.
- Click a sort to reverse its direction; use **×** to remove it.
- **Open as database** converts a single-database query into a linked view, preserving filters, nested AND/OR, relative dates, Type, negated groups, sorting, grouping, and columns. Views have no result limit, so the limit is dropped. Negated groups are converted with De Morgan's laws; “is any of” becomes an OR group. The converted Type filter remains editable in the view's filter bar.
- Single-database results with database-property columns support **inline editing**, indicated by an editable badge. Edits use normal store actions and respect page and row locks. Results spanning databases, standalone pages, or tasks are read-only and merge columns by name.

## Text mode

**Edit query** opens the text representation, synchronized with the visual model. It provides highlighting, suggestions (**⌃Space**, ↑/↓, Enter/Tab), and error locations. English and Portuguese syntax are both supported.

```text
table from "Projects" where Status = "In progress" and Deadline < today+7d sort Deadline limit 20
list from all pages where edited is last 7 days and (title contains "plan" or words > 100) sort edited desc
board from "Projects", "Tasks" group by Status columns title, Status, Deadline, database
count from tasks where due < today
table from all pages where type = ("Person", "Project") and not (Age < 18 or type is empty) group by type
list from type "Person" sort Age desc columns title, Email, Age, icon
```

### Grammar

```text
query   := [display] [from SOURCE] [where EXPR] [sort by FIELD [desc], …]
           [group by FIELD] [limit N] [columns FIELD, …]
display := table | list | gallery | board | count
EXPR    := COND { (and | or) COND }
COND    := FIELD OP VALUE | FIELD is empty | FIELD is not empty | not ( EXPR )
VALUE   := … | ( VALUE, VALUE, … )
```

`and` takes precedence over `or`; use parentheses to group expressions. A value list means “any of,” or “none of” with `!=`.

| Source | Example |
|---|---|
| Database(s) | `"Database"` or `"Database A", "Database B"` |
| All pages | `all pages` |
| Direct children | `children of this page` or `children of "Title"` |
| All descendants | `descendants of this page` |
| Tag | `#tag` or `tag "my tag"` |
| Recently modified | `modified in the last 7 days` |
| Related pages | `related to this page in "Database"` |
| Backlinks | `backlinks of "Title"` or `mentions` |
| Tasks | `tasks` or `tasks including done` |
| Object type(s) | `type "Person"` or `type "Person", "Project"` |

A **tag** matches `#tag` in page text or a select, multi-select, or status option with that name. To filter by object type, use a type source or the `type` field (`type = "Person"`, `type != "Tags"`, `type = ("A", "B")`, `type is empty`). The model stores type IDs, so renaming a type does not break the query; text displays its name. Quote a database property named “Type” to distinguish it from the built-in field: `"Type" = "X"`. Use a database source or the `database` field to filter by database.

**Fields:** database properties by name, quoted if they contain spaces or conflict with keywords. Matching ignores accents and case. Page fields are `title`, `created`, `edited`, `parent`, `icon`, `cover` (has cover), `words`, `favorite`, `content`, `database`, and `type`. Tasks additionally support `due`, `done`, and `source`. Object-type fields also work by name, such as `Age > 30`.

**Operators:** `=`, `!=`, `<`, `>`, `<=`, `>=`, `contains`, `not contains`, `before`, `after`, `is empty`, and `is not empty`.

**Values:** quoted text, numbers, ISO dates such as `2026-10-07`, `true`/`false`, `this page`, and relative dates: today, yesterday, tomorrow, this/last/next week, this/last/next month, this/last/next year, last N days, or next N days. Relative dates accept optional `+N`/`-N` offsets in `d`, `w`, `m`, or `y`, such as `today+7d` or `next month-1m`.

Relative dates use the current local date; the week start follows **Settings → Daily workflow**. For a date range, `=` means inside it, `<` means before its start, and `>` means after its end.

The serializer produces canonical text. Tests verify `parseQueryText(serializeQuery(q)) = q` in both languages.

## Updates and performance

- Each block caches results and reruns only when its dependencies change. Database sources depend on the database, its row list, and ancestors' lock/trash state; typing in an unrelated page does not recalculate them.
- Broad sources and fields that read other pages, such as relations, rollups, formulas, parents, or databases, depend on the page collection. Updates debounce for 250 ms and reuse per-row caches.
- Above 8,000 candidates, evaluation runs in roughly 8 ms idle slices.
- Tables are virtualized; lists, galleries, and boards show batches with **Show more**.
- Previous Node benchmarks on M-series hardware measured roughly 150 ms cold / 30 ms cached for 50,000 rows across three databases with nested filters, relative dates, two sorts, and grouping. A content-contains query over 50,000 pages measured roughly 35 ms. Actual performance depends on data and hardware.
- Limits: 64 conditions, eight group levels, eight sorts, 40 columns, and 10,000 result rows.

## Privacy and safety

Trashed and password-protected pages, including all descendants, are excluded even if unlocked in the session. Protected titles and content are not read. A database inside a protected page is skipped with a warning. No data is read while the workspace is locked.

Query evaluation is read-only and uses a dedicated parser, never `eval`. Inline result editing is a separate action subject to normal access checks.

## Persistence, export, and search

The block stores `query` (the JSON model and source of truth) and `text` (its text form) in props. Older or incomplete data is normalized; corrupt JSON is preserved and the block offers to start over.

Copy/paste, page duplication, moving between pages, and undo/redo use normal block behavior. Duplication remaps page/database IDs in query JSON. After moving a query, “this page” refers to the destination.

Markdown/HTML export renders the current result as a table or list with links to exported pages. It includes a legacy-format `<!-- np:query "query text" -->` comment and a complete `<!-- np:block … -->` record for round-trip import. A hand-written `np:query` comment also imports and resolves workspace names when opened. These markers are stable file-format identifiers.

Search indexes the query text, never its results.

## Known limitations

- Property fields are referenced by name. Renaming a property requires updating the query; invalid filters are highlighted with a warning.
- Grouping is one level. Multi-select values group by combined text; Type is the exception, placing a page in each of its type groups.
- **Open as database** requires a single database. Type fields missing from that database prevent conversion, with a warning identifying the field. Type filters enter database views through this conversion; the database's **Add filter** picker does not yet offer Type.
- Quick type-filter counts use a second cached evaluation when a type rule or result limit exists. Above 8,000 candidates, chips appear only without either condition.
- Single-page export through ⌘K uses BlockNote's converter, which does not resolve “this page.”

## Code references

| Area | Files |
|---|---|
| Model and normalization | `src/query/model.ts` |
| Evaluation and dependencies | `src/query/engine.ts`, sharing `src/components/database/filterEngine.ts` with `applyView` |
| Text, highlighting, suggestions | `src/query/text.ts` |
| Virtual database and conversion | `src/query/virtualDb.ts`, `src/query/convert.ts` |
| Live cache and export | `src/query/live.ts`, `src/query/exportResult.ts` |
| Interface | `src/components/query/` |
| Type fields and facets | `src/query/typeField.ts`, `src/query/facets.ts` |
| Tests | `tests/query-engine.test.mts`, `tests/query-text.test.mts`, `tests/query-integration.test.mts`, `tests/query-ui.test.mjs`, `tests/query-types.test.mts`, `tests/query-types-ui.test.mjs` |
