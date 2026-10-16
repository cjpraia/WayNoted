# Building and distribution

Builds target macOS on Apple Silicon and Windows 11 x64/ARM64. Windows installers are built and verified on Windows CI. Public releases state whether the binaries have a publisher signature.

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

The installed-app checks use disposable data in a path containing spaces and Unicode. They check page creation, persistence, native clipboard/OCR, bundled CLI/MCP, DPAPI, password vault lock/unlock, restart, and preservation through uninstall/reinstall. They also install the previous version from its pinned source revision, create and encrypt data, upgrade with the new installer, and verify the original page IDs and content. A custom installation directory containing spaces and Unicode is exercised through reinstall, vault access, and the bundled CLI. A password-protected backup generated by the macOS job is restored on both Windows architectures, including database row values and separately password-protected pages. Reports, screenshots, installers, and SHA-256 checksums are retained as workflow artifacts. Only a passing package job counts as a validated build; an artifact uploaded from a failed job is diagnostic output.

To run the same check manually:

```powershell
node scripts/check-package.mjs --allow-install --installer="C:\build\WayNoted-Setup-1.0.0-win-x64.exe"
```

`npm run dist:test` creates a separate test identity, installer directory, and default `WorkspaceDataTest` profile. Test builds do not register the production page-link protocols. Pass the test executable path with `--app` when checking it. Do not run install/uninstall checks over an important personal installation. Reports belong in `.artifacts/package-check/`, never in `docs/` or a committed profile.

### Signing and public release

The public Windows installers currently have **no Authenticode publisher signature**. They are installable desktop releases; Windows may display an unknown-publisher/SmartScreen prompt. Smart App Control and organization policies can block unsigned software. Do not describe them as signed, or ask users to disable their computer's protection. See [Microsoft's SmartScreen guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

An Authenticode publisher identity is recommended for broader distribution. The Windows builder signs the application, native helper, CLI launcher, installer, and uninstaller when signing credentials are configured. Set `WORKSPACE_REQUIRE_SIGNING=1` in a protected signing environment to fail a build without a certificate. Use electron-builder's supported certificate/service configuration; never commit private keys or expose signing secrets to pull-request workflows. A signature identifies the publisher but does not guarantee immediate SmartScreen reputation.

Run the **Publish Windows release** workflow manually from `main` to publish a new version. It rebuilds and verifies both installers and runs the shared tests before publishing. The package version must be a final semantic version, and an existing release is never overwritten. Installers, SHA-256 checksums, verification reports, a manual-update feed, and English release notes are uploaded together. Packaging does not publish by itself.

The upgrade baseline is pinned in `.github/workflows/desktop.yml`; advance it to the previous released revision when preparing subsequent versions. No new storage schema migration is introduced by version 1.0.1; the upgrade check verifies installer replacement and continued access to existing encrypted data.

Physical microphone capture, Windows Hello interaction, keyboard layouts, accessibility, and display scaling depend on user hardware/settings and still require interactive coverage beyond the CI checks. Passing automated tests is not a claim that every possible Windows configuration has been exercised.

The app includes its project license and `THIRD-PARTY-NOTICES.md`. Setup displays the project license and separate Windows SDK terms. Original native license texts and a dependency manifest are packaged in `resources/native-licenses/`.

Windows 10, 32-bit Windows, Microsoft Store/MSIX, MSI, and portable-profile distributions are not advertised targets. Manual update checks remain user-initiated; the installer does not enable background updates.
