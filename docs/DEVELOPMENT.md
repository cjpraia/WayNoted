# Development

## Environment

The desktop app targets macOS Apple Silicon and Windows 11 x64/ARM64. Use Node.js 24 and npm. macOS native builds require Xcode Command Line Tools. Windows native builds require .NET 10 SDK and Visual Studio C++ Build Tools with a matching target toolchain; run packaging from Developer PowerShell. The Windows helper is published self-contained, and the native CLI launcher embeds no dependency on a separate Node.js installation.

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run dist
```

On Windows, run `npm run build:native` before testing native integrations in development. Use `npm run dist:win` for x64 or `npm run dist:win:arm64` for ARM64 on a Windows build host. Cross-packaging Windows from macOS is deliberately rejected.

`npm run dev:web` runs only the interface on port 5310; it does not replace Electron when validating storage and native integrations. `./scripts/launch.command` rebuilds and opens the app. The bundle is created at `release/Desktop-darwin-arm64/Desktop.app`; see [Distribution](DISTRIBUTION.md) for signing.

## Structure

| Path | Responsibility |
|---|---|
| `src/` | React interface, editor, databases, queries, and domain models |
| `electron/` | Main process, IPC, persistence, local API, CLI, MCP, and access policies |
| `native/` | Swift helper for macOS and C# / C++ helpers in `native/windows/` |
| `shared/` | Product record and compatibility adapters |
| `build/` | Configuration, compilation, and signing |
| `clipper/` | Browser extension and local API client |
| `tests/` | Unit tests and simulated-DOM interface tests |
| `scripts/` | Checks and maintenance tools |

## Public name and stable identifiers

The public name is defined in `shared/product.json`. Run `npm run configure` after changing it; this updates `package.json`, the lockfile, manifests, extension registrations, and permission descriptions. The interface reads the same record.

A brand change must preserve technical identifiers:

- Profiles: `~/Library/Application Support/WorkspaceData/` on macOS, `%APPDATA%\WorkspaceData` on Windows.
- New-installation Keychain identity: `Workspace`, persisted per profile.
- Bundle identifiers: `app.workspace.desktop` and `app.workspace.native`.
- Executables: `Desktop` and `workspace-native` (with `.exe` on Windows).
- Windows installer directory: `%LOCALAPPDATA%\Programs\WorkspaceDesktop`; installer GUID and AppUserModelID stay stable across brand changes.
- CLI/MCP: `workspace`; environment variables: `WORKSPACE_*`.
- New links: `workspace://`.

`electron/brand.cjs` preserves existing profiles' Keychain identity in `profile-identity.json` and migrates the previous directory without replacing an existing generic profile.

`shared/compatibility.json` contains historical identifiers encoded in base64; they are not secrets. They preserve existing file formats, encryption, storage keys, and links. Do not replace these values during rebranding: doing so can make existing data unreadable.

## Languages

The interface supports `en-US` and `pt-BR`. New profiles start in English; existing saved preferences and legacy metadata retain their language. Keep both translations when changing user-facing strings. Public documentation, issues, and pull request descriptions should use English.

## Tests and verification

Use `npm test`, which runs each test file in a separate process with memory and time limits. To run a specific file:

```bash
node scripts/run-tests.mjs tests/identity.test.mjs
```

DOM tests do not prove native behavior. Before a release, also check bundle launch, page reading and writing, database-row editing, export/import, and changed integrations using temporary data.

The cross-platform installed-app check uses the pinned `playwright-core` dependency and a disposable profile with spaces and Unicode in its path:

```bash
npm run check:package -- --app=/absolute/path/to/executable
# On Windows, install and check the generated Setup executable:
node scripts/check-package.mjs --allow-install --installer="C:\absolute\path\WayNoted-Setup-1.0.0-win-x64.exe"
```

Reports and screenshots go in `.artifacts/package-check/`. The Windows check exercises editing, native clipboard/OCR, bundled CLI and MCP, device encryption, password vaults, restart, uninstall, and reinstall. Microphone capture, Windows Hello user verification, display scaling, and assistive technology still need interactive device validation. CI runs shared tests on macOS, Windows x64, and Windows 11 ARM64, then builds and checks both Windows packages. A package job must pass its checks before its artifact is treated as validated.

The older macOS interaction script `scripts/ensaio-pacote.mjs` also remains available; see its header for its external Playwright setup.

The optional `scripts/audit-originality.mjs` requires an external reference archive and writes `.artifacts/originality.md`. Generated artifacts are ignored by Git and excluded from the distributed bundle.

## Interface and maintenance

Check the tokens in `src/styles/`, components in `src/components/ui/`, and the icon registry before adding variations. Preserve accessible names, keyboard focus, and contrast/motion preferences. See the minimum accessibility checklist in [Usage](USAGE.md#appearance-and-accessibility).

Update the guide responsible for the behavior you change. Avoid one document per task, duplicated code catalogs, or dated reports in `docs/`. Temporary results belong in `.artifacts/`; secrets and personal data never belong in the repository.

See [Contributing](../CONTRIBUTING.md) for the pull request process.
