# Security and data

## Local storage

The default profile is stored at `~/Library/Application Support/WorkspaceData/`. The default workspace uses `data/`; additional workspaces use `workspaces/<id>/data/`. **Settings → Data → Open data folder** shows the effective path.

Without a workspace password or device encryption, local files are readable by processes running as your user. File permissions do not replace encryption.

The app uses atomic writes and transaction logs to recover interrupted operations. Metadata includes a schema version: incompatible versions must be rejected without replacing data. Keep an independent backup before updating or migrating an important installation.

## Passwords and Keychain

- **Workspace password:** a vault using a scrypt-derived key and AES-256-GCM protection, with automatic locking and a recovery key.
- **Page password:** protects a page and can be inherited by subpages.
- **Touch ID:** optional unlocking linked to macOS Keychain.
- **Device encryption:** optional AES-256-GCM protection with a random key protected by Keychain; disabled by default on new installations.

Protected content cannot be recovered without the password or recovery key. Keep the recovery key outside the app.

Keychain access goes through `electron/keychain.cjs`. A new installation without Keychain-dependent options should not access it during normal use. Device encryption, legacy format migrations, Touch ID, and stored AI keys may require access.

Existing profiles preserve the identity needed for their keys in `profile-identity.json`. New installations use a generic technical identity. Do not rename Keychain records or compatibility identifiers to match the public brand.

## Migrations

Legacy encryption migration requests consent before accessing Keychain. Conversion verifies content and keeps a recovery journal and a temporary copy of the previous format. If the key is unavailable or access is denied, the app must report an error without replacing data.

The pre-migration copy is retained for 14 days and can be removed in settings. It does not replace an external backup maintained by the user.

## Caches and protected pages

Chromium can retain text in IndexedDB and other stores. When content is protected or locked, the app purges related caches; with a workspace password, search indexes stay in memory. Protected pages are excluded from persistent indexes and agent/AI context.

Use the app's actions to protect pages and clear data. Manually deleting LevelDB files while the app is open can corrupt storage.

Relevant code: `electron/browser-storage.cjs`, `electron/vault*.cjs`, `src/search/`, and `src/ai/`.

## Backups and Markdown mirror

External backups include SHA-256 verification and restore support. Retention and restore controls are available in the app.

Manual exports, portable backups, and the Markdown mirror may contain readable text. A protected workspace can produce an encrypted backup; check the operation type before sharing a file. The optional Markdown mirror does not synchronize edits back into the app. Previously exported files are not retroactively protected when a page is locked.

## Network and remote content

There is no telemetry or built-in cloud sync. Optional features can use the network:

| Feature | Destination and control |
|---|---|
| Cloud AI | Selected provider, with a key and consent; see [AI](AI.md) |
| Link preview or embedded website | Requested site and its resources, subject to remote-content policies |
| Video player | Allowed provider; loading/blocking modes control navigation |
| Update check | Configured HTTPS destination, only when requested |
| CLI, API, MCP, webhooks, and clipper | Local communication; see [Local integrations](LOCAL-INTEGRATIONS.md) |

Embedded content can reveal your IP address and use provider-side mechanisms. Isolation, sandboxing, and destination validation remain necessary when a user chooses to load remote content.

## Agents and integrations

The API listens only on `127.0.0.1`, requires a token, and enforces per-client scopes. Writes require approval by default and recheck the version before saving. Automatic writes are an explicit per-client option. Tokens can be revoked.

AI-private pages and their descendants are excluded from the API and cloud AI context. Protected and trashed pages are also filtered. Canvas scenes and synced blocks have specific restrictions against replacement through paths outside the editor.

Do not expose the port through a proxy, tunnel, or port forwarding. Never commit tokens, keys, profiles, personal backups, or certificates to Git.

## Relevant checks

Storage, vault, migration, agent-access, local-policy, and provider tests exercise these boundaries. Tests are not an independent audit. Native permissions and macOS behavior require verification in the packaged app. See [Distribution](DISTRIBUTION.md) for signing.
