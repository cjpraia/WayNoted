# Database implementation boundaries

Database features use optional schema fields to preserve existing files. This document records local implementation constraints; feature presence in code does not prove persistence, accessibility, or packaged-app behavior.

| Area | Implemented behavior | Remaining boundary |
|---|---|---|
| Properties | Number formats, status groups, IANA time zones, formulas, aggregations, local authors, sequential IDs, places | Authors are local identities. Ambiguous daylight-saving times do not offer first/second occurrence selection. |
| Formula evaluation | Comparisons, logic, text, dates, lists, `map/filter/find/findIndex/some/every`, `current/index`, `let/lets`, bilingual diagnostics | No user JavaScript. Limits: 512 tokens, 64 levels, 1,000 items per list, 20,000 evaluation steps. Output lists follow `PropValue` conversion rules. |
| Large schemas | Order and duplication checks with temporary 500-property fixtures | Real visual testing is still needed for 500-column interface performance. |
| Relations | Local bidirectional relations with mirrored values and atomic rollback | No relations across independent account workspaces. |
| Rows | Local people, attachments, buttons, subitems, dependencies, property comments, layouts | People, notifications, and media remain local. |
| Views | Conditional colors, nested filters, groups/subgroups, visibility, search, calculations, previews, frozen columns | Previews depend on available local blocks. |
| Additional views | Draggable timeline, charts and exports, dashboard, local SVG map, feed, personal form | No remote map tiles, geocoding, or public form links. |
| Linked sources | View links, linked databases, local sources within one workspace | Differing schemas require explicit mappings; no remote source. |
| Automation | Local button actions, rich row templates, recurrence, scheduled/property triggers | Scheduling requires the local app/helper to be running. Virtual occurrences lack per-occurrence exceptions. |
| CSV round trips | Identity columns, relations, rich text, dates, data-URL attachments, two-pass import | Maximum 50 MB and 10,000 rows. Auxiliary property IDs must match; this is not a universal cross-schema package. |
| Integrations | Validated local property and block-button action sequences | No arbitrary code or simulated remote delivery. AI needs a configured provider and permission; external services need their own connection and account. |

For supported workflows, see [Usage](../../../docs/USAGE.md). Test persistence and the packaged interface with temporary data before considering a behavior verified.
