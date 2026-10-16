# Local integrations

## API and clients

Enable **Settings → Data → Local API for integrations** and use the URL displayed in the app. The port is persisted when possible; check the current address rather than hard-coding a port.

The API listens only on `127.0.0.1` and requires `Authorization: Bearer TOKEN`. Each client can have its own token and scopes, managed under **Agents and permissions**. Never put tokens in the repository or messages.

Writes require approval by default and may wait for a response in the app. The timeout is configurable; a lack of approval is not success. Clients can receive `APPROVAL_TIMEOUT`, `APPROVAL_REJECTED`, `SCOPE_REQUIRED`, a version conflict, or a lock error. Do not bypass these results by repeating a write without reading again.

## CLI

On macOS, the bundle includes `Desktop.app/Contents/Resources/bin/workspace`; Windows includes `<installation>\resources\bin\workspace.exe`. Both use the embedded Electron runtime and need no separate Node.js installation. Install the command on PATH from settings. On Windows this changes only the current user’s PATH; reopen the terminal afterward. It does not require administrator access or symlink privileges. In a checkout, use `npm run cli -- <command>`.

```bash
workspace help
workspace whoami
workspace search "Project"
workspace page get UUID
workspace page append UUID "Additional text"
workspace tasks today
workspace types list
workspace query "list from tasks where due < today"
```

The CLI discovers the connection in the local profile. Explicit configuration supports `--url`, `--token`, `--data-dir`, and the `WORKSPACE_API_URL`, `WORKSPACE_API_TOKEN`, `WORKSPACE_DATA_DIR`, and `WORKSPACE_USER_DATA` environment variables. `--json` returns structured output; see `workspace help` for each operation's arguments.

Exit codes: `0` success, `1` usage/connection error, `2` API error, `3` rejected change, `4` approval timeout.

## MCP

Transport is stdio. Run the bundled CLI with `mcp`, or use `node electron/mcp-server.cjs` in a checkout. The direct server requires `WORKSPACE_API_URL` and `WORKSPACE_API_TOKEN`; the CLI can also discover the local connection.

Settings provides snippets with the actual paths for MCP clients and a setup command for Claude Code. Generic example for clients using `mcpServers`:

```json
{
  "mcpServers": {
    "workspace": {
      "command": "/absolute/path/to/Desktop.app/Contents/Resources/bin/workspace",
      "args": ["mcp"],
      "env": {
        "WORKSPACE_API_URL": "http://127.0.0.1:PORT",
        "WORKSPACE_API_TOKEN": "CLIENT_TOKEN"
      }
    }
  }
}
```

On Windows use the absolute `workspace.exe` path in `command`; JSON backslashes must be escaped, for example `C:\\Users\\User\\AppData\\Local\\Programs\\WorkspaceDesktop\\resources\\bin\\workspace.exe`. Settings generates the correct JSON and PowerShell commands automatically.

Use absolute paths and replace the placeholders. Restart or reload the client session after changing configuration.

Available tools:

- Pages and content: `search_pages`, `get_page`, `get_blocks`, `create_page`, `update_page`, `replace_blocks`, `append_to_page`.
- Row properties: `get_row_properties`, `update_row_properties`.
- Daily workflow: `list_tasks`, `add_task`, `get_daily_note`, `append_to_daily`.
- Queries and types: `run_query`, `list_types`.

Before replacing blocks, call `get_blocks` and send its `ETag`. Before editing row properties, call `get_row_properties` and send its `ETag` to `update_row_properties`. Prefer appending text when replacing the whole page is unnecessary.

Properties are identified by ID. Select/status values accept option names or IDs; relations use destination record IDs. Titles, attachments, and calculated values have specific restrictions. Canvas scenes are not exposed as editable MCP data.

## HTTP

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/whoami` | Client identity and permissions |
| GET | `/v1/pages`, `/v1/search?q=text` | List and search |
| GET | `/v1/pages/UUID` | Read a page |
| POST | `/v1/pages` | Create a page |
| PATCH | `/v1/pages/UUID` | Title, favorite, or trash state |
| GET / PUT | `/v1/pages/UUID/blocks` | Read / replace blocks |
| POST | `/v1/pages/UUID/append` | Append content |
| GET / PATCH | `/v1/pages/UUID/properties` | Read / edit row properties |
| GET / POST | `/v1/tasks` | List / create tasks |
| GET | `/v1/daily/DATE` | Daily note (`YYYY-MM-DD` or `today`) |
| POST | `/v1/daily/DATE/append` | Append to a daily note |
| POST | `/v1/query` | Run a query |
| GET | `/v1/types`, `/v1/events?after=TIMESTAMP` | Types / activity |

Block replacement and property updates require `If-Match` with the previous `ETag`. There is no permanent-deletion endpoint. See `electron/local-api.cjs` and the `local-api*` and `mcp-server` tests for the detailed contract.

## Webhooks

Receivers must use `http://127.0.0.1:PORT/path`. The app sends POST events with `X-Workspace-Event` and `X-Workspace-Signature`. Validate the raw body's HMAC-SHA256 using the webhook secret; signatures start with `sha256=`.

Failed deliveries are retried with increasing delays. Deduplicate by event ID: a delivery can repeat after an interruption. Secrets and delivery logs stay local.

## Web clipper and native features

The clipper uses separate pairing and can only create clips; it does not receive general access to notes. See [Web Clipper](../clipper/README.md) for installation and pairing.

Apple Calendar, Reminders, Notes import, and Apple embeddings remain macOS-only. Internal tasks, calendar views, and daily notes work on both platforms. OCR uses the OS engine on macOS and Windows. Windows needs an installed OCR language. Native dictation uses offline OS speech recognition and requires an installed recognizer for the selected language and microphone permission. Availability depends on the Windows image and language; the app reports unavailable recognizers instead of uploading audio. Windows Hello requires a configured compatible device/account. Configure native features in the app and Windows/macOS settings.

Internal links use `workspace://page/UUID`, with `#block=ID` or `#view=ID` where applicable. Routes also exist for home, tasks, graph, productivity, types, daily notes, search, new pages, and quick capture. See `electron/deep-links.cjs` and `electron/quick-capture-core.cjs` for route contracts.

See [Security](SECURITY.md) for privacy and page-protection policies.
