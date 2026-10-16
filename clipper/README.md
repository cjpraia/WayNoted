# WayNoted Web Clipper

A Manifest V3 extension for **Chrome, Edge, Brave, and Arc** that sends the current page to WayNoted **on this computer**. It only communicates with the app's local API (`http://127.0.0.1:<port>`); there is no external server or account.

## What it captures

The title, URL (without `utm_*`, `fbclid`, or fragment), site name, cleaned main text, current selection when available, featured-image URL (`og:image`), and optional Markdown content, including headings, lists, tables, code, and links. Reader-style extraction removes menus, footers, ads, and scripts.

WayNoted creates a row in **Web clips**, with Name, URL, and Date properties and the captured content in the page. Names follow the workspace language.

## Load the extension

1. In WayNoted, enable the local API in **Settings → Data → Agents**. Under **Web clipper**, generate a pairing code.
2. Open `chrome://extensions` (Edge: `edge://extensions`; Brave: `brave://extensions`; Arc: its Extensions menu).
3. Enable **Developer mode**, choose **Load unpacked**, and select the `clipper/` folder from this repository.
4. Click the extension icon and open its options. Enter the API address shown in WayNoted (`http://127.0.0.1:port`) and the pairing code, then choose **Pair**. Codes expire after five minutes and can be used once.
5. On a page, click the extension icon, choose **Page** or **Selection only**, and send it.

The app persists its port when possible. If the address changes, pair again.

## Security

- **Create-only access.** The paired token (`npc_…`) works only with `POST /v1/clip`, creating pages in the clips database. It cannot read, edit, delete, or access other routes (`403`).
- **Pairing grants approval.** The short code appears only in the app; generating it is the approval step. Subsequent automatic calls are limited to `/v1/clip` and appear in the agent call log.
- **Bound origin.** Only `Origin: chrome-extension://<id>` is accepted, and the token is bound to the paired extension ID. Web pages and other extensions receive `403`; the rest of the API continues to reject any `Origin`.
- **Limits.** Request body ≤ 2 MB, title ≤ 300 characters, text ≤ 300,000 characters, Markdown ≤ 500,000 characters, and 30 clips per minute. URLs must be HTTP/HTTPS without credentials. HTML is converted to text, never executed.
- **Browser-local token.** The token stays in this extension's `chrome.storage.local` and is never displayed. Revoke it in the app's Web clipper settings or unpair in the extension options.
- **Minimal permissions.** `activeTab`, `scripting`, `storage`, and access to `http://127.0.0.1/*`. No scripts on every page, background service, or `<all_urls>` permission.

## Known limitations

- Featured images are stored as links; the app does not download remote images.
- Login-only or heavily scripted pages may yield little text; use **Selection only**.
- Firefox and Safari are not supported; pairing requires a `chrome-extension://` origin.
- Extension icons are not included; the browser uses its default icon.

## Development

Tests cover extraction and the client in jsdom (`tests/clipper-extract.test.mts`) and the `/v1/clip`, `/v1/clip/pair`, and `/v1/clip/whoami` routes (`tests/clipper-api.test.cjs`):

```bash
node scripts/run-tests.mjs tests/clipper-extract.test.mts tests/clipper-api.test.cjs
```

See [Contributing](../CONTRIBUTING.md) before submitting a pull request.
