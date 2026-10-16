# Building and distribution

Builds target macOS on Apple Silicon and Windows 11 x64/ARM64. Windows installers are built on Windows CI; unsigned validation artifacts are separate from signed public releases.

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
  "downloads": {
    "darwin-arm64": "https://example.com/download/mac",
    "win32-x64": "https://example.com/download/windows-x64",
    "win32-arm64": "https://example.com/download/windows-arm64"
  }
}
```

`version` uses semver; `notes` and download destinations are optional. `downloads` selects the current platform/architecture; a missing target never falls back to another OS. The legacy single `downloadUrl` is still accepted for a generic download landing page. Notes can also include a `pt-BR` translation. Download destinations are validated before opening in the browser. See `electron/update-check.cjs` and `tests/update-check.test.cjs` for the contract and network restrictions.

## Windows builds

Use a Windows build host with Node.js 24, npm, .NET 10 SDK, and Visual Studio C++ Build Tools. Open a Developer PowerShell with the target architecture configured:

```powershell
npm ci
npm run typecheck
npm test
npm run dist:win          # x64
# npm run dist:win:arm64  # ARM64
```

The output is `release/WayNoted-Setup-<version>-win-<arch>.exe`. The display name and artifact prefix come from `shared/product.json`. Build tools are not required on the end user's computer: the installer includes Electron, the self-contained Windows native helper, and the native CLI launcher. macOS-to-Windows cross-packaging is rejected so that native resources cannot be omitted accidentally. The helper pins .NET 10.0.13 and System.Speech 10.0.13; update these alongside the bundled native license texts. See the [.NET support policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core).

The assisted NSIS installer defaults to the current user and does not request administrator elevation. It creates a Start menu entry and offers an optional desktop shortcut. The default installation directory is `%LOCALAPPDATA%\Programs\WorkspaceDesktop`; the application executable is `Desktop.exe`. AppUserModelID, installer GUID, executable names, and data paths stay generic and stable when the public name changes.

The profile is `%APPDATA%\WorkspaceData`, outside the installation directory. Upgrade/uninstall must preserve it. Startup at login remains optional; closing the window keeps the app running only when its tray option is enabled. No Windows service or automatic updater is installed. The application registers its page/block link protocol.

### Windows native features

| Feature | Windows implementation |
|---|---|
| Pages, databases, relations, rollups, queries, canvas, tasks, daily notes, files | Shared Electron/React implementation |
| API, CLI, MCP, webhooks, clipper | Local integration stack; bundled `resources\bin\workspace.exe` needs no separate Node.js |
| Device encryption and stored secrets | Electron safeStorage / Windows DPAPI |
| Optional biometric vault unlock | Native Windows Hello user verification, when configured |
| OCR | Windows.Media.Ocr using installed OCR languages |
| Dictation | Offline System.Speech recognizer, when installed for the selected language |
| Apple Calendar, Reminders, Notes import, Apple embeddings | macOS-only; internal tasks/calendar remain available |
| Audio-file transcription | Optional local transcription runtime/model, configured separately |

OCR language packs and speech recognizers depend on the Windows image. The helper returns an explicit availability/error result; it does not switch to cloud recognition. Native dictation does not guarantee Portuguese (Brazil) support: the built-in Windows Speech Recognition language list excludes Portuguese, and a display-language pack does not add a compatible SAPI recognizer. The app reports this explicitly rather than falling back to cloud recognition. Local audio-file transcription remains a separate option with a configured runtime/model. See [Microsoft’s supported speech-recognition languages](https://support.microsoft.com/pt-br/accessibility/windows/voice-access/windows-speech-recognition-commands). Actual microphone capture and Hello user verification require interactive hardware validation and cannot be established by a headless runner.

DPAPI is tied to the Windows user context, not to a vault password or biometric verification. Programs running as the same user can have different access than with macOS Keychain. See [Security](SECURITY.md) and [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).

Move workspaces through a supported portable backup/export and restore. Do not copy raw device-bound keys between operating systems. Keep the original files and an independent backup until restored content and protected data have been checked. Portable exports may contain readable text.

### Automated verification

`.github/workflows/desktop.yml` runs type checking and shared tests on macOS, Windows x64, and Windows 11 ARM64. Separate Windows jobs compile C#/C++ helpers, build each architecture, install the Setup executable, and run `scripts/check-package.mjs` against the installed app.

The installed-app checks use disposable data in a path containing spaces and Unicode. They check page creation, persistence, native clipboard/OCR, bundled CLI/MCP, DPAPI, password vault lock/unlock, restart, and preservation through uninstall/reinstall. Reports, screenshots, installers, and SHA-256 checksums are retained as workflow artifacts. Only a passing package job counts as a validated build; an artifact uploaded from a failed job is diagnostic output.

To run the same check manually:

```powershell
node scripts/check-package.mjs --allow-install --installer="C:\build\WayNoted-Setup-1.0.0-win-x64.exe"
```

`npm run dist:test` creates a separate test identity, installer directory, and default `WorkspaceDataTest` profile. Test builds do not register the production page-link protocols. Pass the test executable path with `--app` when checking it. Do not run install/uninstall checks over an important personal installation. Reports belong in `.artifacts/package-check/`, never in `docs/` or a committed profile.

### Signing and public release

CI artifacts are explicitly labeled **unsigned validation builds**. Public stable distribution requires an Authenticode publisher identity and timestamped signatures. The Windows builder signs the main application, native helper, CLI launcher, installer, and uninstaller when signing credentials are configured. Set `WORKSPACE_REQUIRE_SIGNING=1` in the protected release environment so a missing certificate fails the build. Use electron-builder's supported certificate/service configuration; never commit keys or expose signing secrets to pull-request workflows.

A valid signature identifies the publisher; it does not guarantee an immediate SmartScreen reputation or bypass. See [Microsoft's SmartScreen guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation). Unsigned validation builds must not be represented as a signed stable release.

Before publishing a stable release:

- Require passing shared and installed-package checks for the exact source revision and each advertised architecture.
- Verify interactive microphone capture, Windows Hello cancellation/success, keyboard layouts including AltGr, tray/startup, links, accessibility, and display scaling on Windows 11.
- Verify N-to-N+1 upgrades with populated databases and protected data. Same-version reinstall checks do not prove schema-upgrade compatibility.
- Verify backup transfer from macOS and recovery of protected data through the supported export/restore flow.
- Sign all executable components, verify signatures after download, and publish Setup, `SHA256SUMS`, English release notes, supported architectures, and known limitations.
- Include the project license and `THIRD-PARTY-NOTICES.md`. Native Windows license texts and a resolved dependency manifest are packaged in `resources/native-licenses/`.

Windows 10, 32-bit Windows, Microsoft Store/MSIX, MSI, and portable-profile distributions are not advertised targets. Manual update checks remain user-initiated; the installer does not enable background updates.
