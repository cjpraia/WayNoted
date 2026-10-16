# Building and distribution

The current build targets macOS on Apple Silicon. Windows support is planned below; no Windows installer or compatibility claim is available yet.

## Local bundle

```bash
npm run dist
```

This configures product identity, builds the interface, Swift helper, and agent runtime, packages Electron, and verifies the signature. The output is `release/Desktop-darwin-arm64/Desktop.app`, with the public display name from `shared/product.json`.

Signing is ad hoc by default. The code identity can change between builds and trigger new macOS permission or Keychain access prompts.

## Stable signing for local use

To create a local certificate, run once:

```bash
bash build/make-signing-identity.sh
```

The script creates the `Workspace Local Signing` identity in Keychain. macOS may request the Keychain password and administrator authorization. Then build with:

```bash
WORKSPACE_SIGN_IDENTITY="Workspace Local Signing" npm run dist
```

Use the same certificate for the app and helper. Replacing or recreating the certificate changes the identity; keep a secure backup if you need to restore it. Never store certificates or private keys in the repository.

To inspect the bundle:

```bash
codesign --verify --deep --strict release/Desktop-darwin-arm64/Desktop.app
codesign -dv --verbose=2 release/Desktop-darwin-arm64/Desktop.app
codesign -d -r- release/Desktop-darwin-arm64/Desktop.app
codesign -dv --verbose=2 release/Desktop-darwin-arm64/Desktop.app/Contents/Resources/workspace-native
```

`build/sign-app.mjs` checks signatures, helper executables, and the embedded CLI. A locally self-signed identity does not replace Apple distribution signing.

## Distribution to other users

For a signed, notarized release to other Macs, prepare the appropriate distribution identity, component signatures, entitlements, timestamping, and notarization. The notarization workflow is not automated in this project.

`WORKSPACE_SIGN_IDENTITY` selects the certificate; `WORKSPACE_HARDENED_RUNTIME=1` enables the options and entitlements in `build/entitlements.plist`. Review them for the distribution identity you use. A locally self-signed build is not a completed notarized release.

Before distributing, run tests, inspect the bundle with a temporary profile, and review [Licensing](LICENSING.md). See [Development](DEVELOPMENT.md) for the bundle check.

## Update checks

Checking is manual, through **Settings → About → Check for updates**. The user configures the feed URL, which must be public HTTPS. There are no automatic checks, background downloads, or background installations.

Example JSON published by the distributor:

```json
{
  "version": "1.2.0",
  "notes": { "en-US": "Release notes" },
  "downloadUrl": "https://example.com/download"
}
```

`version` uses semver; `notes` and `downloadUrl` are optional. Notes can also include a `pt-BR` translation. Download destinations are validated before opening in the browser. See `electron/update-check.cjs` and `tests/update-check.test.cjs` for the contract and network restrictions.

## Windows distribution plan

Status: proposed implementation plan, based on the current repository. This section does not mean Windows builds are available or tested.

### Release scope

Target **Windows 11 x64** first, using the shared Electron/React codebase. Add a native Windows ARM64 release after testing on ARM hardware. Windows 10 compatibility requires a separate support decision and test matrix; do not advertise it based only on Electron's minimum requirements. Do not target 32-bit Windows with the current Electron 44 dependency.

Ship an offline-capable **NSIS Setup executable** through GitHub Releases. Install for the current user without requiring administrator access. Keep Microsoft Store/MSIX, enterprise MSI, a portable edition, and automatic updates for later milestones. A portable executable must not be described as portable data storage unless its profile and encryption behavior have actually been implemented and tested.

Use a stable, generic installation directory such as `%LOCALAPPDATA%\Programs\WorkspaceDesktop`, a stable application ID derived from `app.workspace.desktop`, and a fixed installer identity. Display WayNoted from `shared/product.json`. Keep `Desktop.exe`, the profile directory, registry identity, and protocol registration independent of future product-name changes. Use `%APPDATA%\WorkspaceData` for the default profile, resolved through Electron rather than hard-coded user paths. Store no notes inside the installation directory.

The public artifact can be named `WayNoted-Setup-<version>-win-x64.exe`, generated from product metadata. Public artifact names may follow branding; technical installation identifiers must remain stable.

### Repository blockers

| Area | Current evidence | Required change |
|---|---|---|
| Packaging | `build/package.mjs` fixes `darwin`/`arm64`, embeds a Swift helper, and calls `plutil` and macOS signing | Add explicit platform/architecture targets and separate macOS/Windows packaging paths. Include only resources for the target OS. |
| Development commands | `package.json` uses POSIX inline environment assignments | Use a portable Node launcher or compatible environment handling, and define Windows build commands without changing existing macOS behavior. |
| Native features | `electron/native-helper.cjs` accepts only macOS; `native/` uses Apple frameworks | Expose a capability map. Keep unavailable features disabled or hidden with an explanation; do not invoke Apple executables or open Apple privacy URLs on Windows. |
| Window and tray | `electron/main.cjs` uses `hiddenInset` and traffic-light placement; `electron/tray.cjs` creates a macOS template icon | Configure Windows title bars, window controls, taskbar identity, notifications, tray assets, and close/quit behavior. Validate normal and quick-capture windows. |
| CLI discovery | `electron/cli.cjs` defaults to `Library/Application Support` | Share platform-aware profile discovery with the desktop app and honor existing explicit connection/data-directory options. |
| CLI/MCP launcher | `build/bin/workspace` is a POSIX shell script; `electron/agent-connector.cjs` installs a Unix symlink and quotes for a POSIX shell | Provide a Windows launcher, optional per-user PATH setup, correct command quoting, and Windows-specific snippets. Test PowerShell, cmd, and MCP clients. |
| Credential storage | `electron/keychain.cjs` wraps Electron storage, but messages and assumptions refer to Keychain | Use an OS-neutral credential interface over Electron's Windows backend; preserve existing format identifiers. Adapt messages and test unavailable/corrupt credentials. |
| File safety | Storage, backups, and mirrors use temporary files and rename operations; Unix modes appear throughout | Verify Windows replacement, locked-file handling, antivirus interference, case-insensitive collisions, reserved names, Unicode, long paths, and restore rollback. Treat Unix mode bits as insufficient Windows access control. |
| Tests | `scripts/run-tests.mjs` uses `ps` and Unix process-group termination; bundle checks assume macOS | Add platform-specific process monitoring and child-tree cleanup, classify native tests, and run packaged-app checks on Windows. |
| Updates | `electron/update-check.cjs` accepts one download destination | Select a platform/architecture-specific feed or backward-compatible artifact metadata so Windows users never receive a Mac download. |

### Feature availability for the first Windows release

| Feature | Initial Windows target |
|---|---|
| Pages, block editor, databases, relations, rollups, queries, object types, canvas | Include; verify persistence and interaction in the Windows package |
| Internal tasks, daily notes, calendar navigation, PDF viewing/annotation, supported import/export formats | Include; distinguish the app's calendar from Apple Calendar integration |
| Local API, CLI, MCP, webhooks, web clipper | Include after launcher, profile discovery, permissions, and client tests |
| Cloud AI and local Ollama | Include after provider tests; do not download models silently |
| Password vault, protected pages, recovery, backup/restore | Include only after Windows encryption and cross-platform backup tests pass |
| Device-bound credential protection | Use Electron storage backed by Windows DPAPI; optional, with platform-appropriate explanations |
| Quick capture, tray, notifications, clipboard, custom links | Include after Windows-specific integration tests |
| Apple Calendar, Reminders, Notes import, Touch ID, Apple embeddings | macOS-only; no substitute or parity claim in the first Windows release |
| OCR and in-app native dictation | Unavailable until a Windows/local backend is implemented and validated. Do not silently switch to a cloud service. |

DPAPI protects device-bound keys using the Windows user context; it is not equivalent to page-password encryption or a Windows Hello user-presence check. Do not relabel Touch ID as Windows Hello without a real biometric implementation. The same-user security properties differ from macOS Keychain; see [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).

Move data between systems through a supported portable export/backup and restore workflow, with verification and explicit handling of protected data. Do not instruct users to copy device-bound encryption keys or assume a raw Mac profile can be decrypted on Windows. Confirm which backup formats retain protection; portable exports can contain readable content. Keep original files and an independent backup until the restored workspace has been checked.

### Packaging and signing design

Keep the current macOS packager and introduce a Windows-specific `electron-builder` NSIS configuration. Use the current stable tooling release verified at implementation time, pin it in the lockfile, and review its licenses. Build on a Windows runner with a fresh `npm ci`; never copy macOS `node_modules` into a Windows release.

Generate Windows configuration from the same product record. Preserve a fixed app/installer identity across display-name changes. Add an ICO asset derived from the existing artwork, application version metadata, Start menu entry, optional desktop shortcut, and `workspace://` protocol registration. Handle custom links both on a cold launch and through an existing process; validate input and preserve normal argument parsing.

Use a tested assisted, per-user install flow. Upgrades and uninstall must preserve `%APPDATA%\WorkspaceData`; deleting user data must remain a separate explicit action. Test the real uninstaller with the custom profile path rather than relying only on an installer option. Avoid introducing a service, administrator requirement, or automatic startup by default. See the [stable NSIS documentation](https://www.electron.build/v26/docs/nsis/).

Provide a small signed `workspace.exe` launcher that forwards arguments and stdio to the bundled CLI runtime without requiring Node.js on the user's machine. It must launch MCP without a GUI or console window, preserve exit codes, handle paths containing spaces, and keep authentication tokens in environment/configuration rather than command-line arguments. A `.cmd` convenience wrapper may be added for interactive use, but MCP configuration must not assume clients can execute batch files directly. Do not require administrator-only symlink creation or modify another application's configuration silently.

Sign application executables, the CLI launcher, installer, and uninstaller with an appropriate Authenticode identity and timestamp. Choose the signing provider after checking the publisher's identity, country eligibility, cost, and CI support. Microsoft Artifact Signing is an option where eligible; a suitable CA-backed signing service is another. Store no private keys in the repository, and never expose signing credentials to pull-request workflows.

A valid signature establishes publisher identity but does not guarantee an immediate SmartScreen bypass. Keep the publisher identity consistent and verify the downloaded binary on a clean machine. See [Microsoft's SmartScreen guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

### Implementation sequence and release gates

| Milestone | Deliverable | Acceptance gate |
|---|---|---|
| 1. Platform boundary | Capability map, Windows paths, portable commands, window/menu/shortcut behavior | App launches on Windows without Apple tools. Unsupported actions explain their status. Core editing survives restart. Existing macOS tests still pass. |
| 2. Data and integrations | Storage/encryption adaptation, backup round trip, CLI launcher, MCP configuration, protocol handling | Protected data remains recoverable through the documented path. CLI/MCP can search, read, and edit test data with scopes, approval, and version checks. |
| 3. Installable beta | Windows NSIS package, icons, stable identity, install/upgrade/uninstall behavior | A clean Windows 11 user can install and use it without Node.js or administrator rights. Upgrade, uninstall, and reinstall preserve notes and vault access. |
| 4. Release pipeline | Windows CI, checksums, notices, signed artifacts, platform-specific update feed | A protected release job produces a verified draft release from one approved source revision. Secrets are unavailable to untrusted code. |
| 5. Public release | Clean-machine validation, known-limitations list, release notes and download instructions | All checks below pass. Maintainer publishes the reviewed release. ARM64 and additional distribution channels remain separate gates. |

The pipeline should run type checks and meaningful shared tests on Windows and macOS, with explicit expected results for unsupported native features. Package checks must run the installed app, not only a browser build. A failed Windows test must not be hidden by skipping the whole suite. Keep unsigned CI artifacts restricted to development/beta validation and label them accordingly.

Release assets: signed Setup executable, `SHA256SUMS`, versioned English release notes, supported OS/architecture, known feature limitations, and the applicable project/third-party licenses. Include the licenses inside the installed app as well. The noncommercial terms remain unchanged.

Keep update checks manual for the first Windows release. An explicit check should resolve to the matching Windows artifact and show its version/release notes. Download and installer execution remain user actions. Automatic updates require a later design for signed update metadata/artifacts, publisher verification, schema compatibility, pending-write handling, and recovery; do not enable them incidentally by adding installer tooling.

### Windows acceptance checklist

- Fresh installation without development tools; standard user account; install path and user name containing spaces and non-ASCII characters.
- Cold launch, second-instance activation, multiple windows/tabs, custom page/block links, clipboard, file dialogs, tray, notifications, and quick capture.
- Ctrl-based shortcuts, AltGr text entry, keyboard navigation, screen-reader checks, 100%/150%/200% scaling, light/dark themes, and both interface languages.
- Page/database/canvas edits and attachments survive restart; internal links, relations, and rollups remain intact after import/export.
- Windows reserved filenames, case collisions, blocked/locked files, interrupted writes, restore failures, and low-disk conditions do not silently replace valid data.
- Vault creation, locking, recovery, device encryption, provider credentials, backup transfer from macOS, restore, update, uninstall, and reinstall.
- CLI and MCP over stdio, including launch paths with spaces, token revocation, approval denial/timeout, stale ETags, and protected-page exclusion. API remains loopback-only.
- Install version N, upgrade to N+1, preserve notes/settings/credentials, and safely reject unsupported schema downgrades. Restoring an older build requires a compatible backup, not an assumed executable rollback.
- Verify signatures and checksums of downloaded release assets. Test with normal Windows security controls enabled; do not ask users to disable antivirus or protection features.

Before public release, access is needed to a real Windows 11 x64 machine or VM, a validated publisher signing identity, and a protected release environment. These are implementation/release prerequisites, not prerequisites for reviewing this plan.
