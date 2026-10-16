# Windows installation

WayNoted supports **Windows 11 x64 and ARM64**. Installers include the application runtime, native components, CLI, and MCP server. You do not need Node.js, .NET, a developer terminal, or an account.

## Install

1. Open the [latest release](https://github.com/cjpraia/WayNoted/releases/latest).
2. Download the `win-x64.exe` Setup for Intel/AMD PCs, or `win-arm64.exe` for ARM/Snapdragon PCs. Find your architecture in **Windows Settings → System → About → System type**.
3. Run Setup and follow its instructions. Installation is for your Windows user and does not need administrator privileges.
4. Open **WayNoted** from the Start menu.

The current installers are **unsigned**. Windows may show an unknown-publisher or SmartScreen warning. Verify the download came from this repository and compare its SHA-256 checksum with `SHA256SUMS` on the release page. When Windows offers **More info → Run anyway**, proceed only if you trust this source. Smart App Control or organization policies can block unsigned applications entirely; do not disable those protections to install the app. Publisher signing is not yet configured. See [Microsoft's guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

To calculate a checksum in PowerShell:

```powershell
Get-FileHash "$HOME\Downloads\WayNoted-Setup-1.0.1-win-x64.exe" -Algorithm SHA256
```

## Use and update

Pages, the block editor, databases, relations, rollups, queries, tasks, calendar views, daily notes, files, canvas, and local agent integrations work on Windows. Shortcuts use **Ctrl** in place of **Command**. The window uses native Windows minimize, maximize, and close buttons.

Download the newer Setup matching your architecture, close WayNoted (including its tray icon if enabled), and run Setup. Your notes remain in `%APPDATA%\WorkspaceData`, separately from the app in `%LOCALAPPDATA%\Programs\WorkspaceDesktop`. Uninstalling preserves your notes; keep an independent backup before updating or moving computers.

Updates are manual. To use **Settings → About → Check for updates**, configure this feed:

```text
https://github.com/cjpraia/WayNoted/releases/latest/download/updates.json
```

The app contacts that URL only when you ask it to check. It does not install updates in the background.

## Move data from another computer

For a portable JSON copy of unprotected pages, use **Settings → Data → Export backup** on the source computer, transfer the file, then choose **Import backup** on Windows. Import adds copies alongside existing pages. Exported content is readable; handle the file accordingly. JSON export/import refuses separately password-protected pages because that format cannot restore their keys; use the complete external backup below for those pages.

For an encrypted whole-workspace transfer, use **External backup** with a workspace password and device encryption turned off on the source. Copy the complete backup folder, including its `default` subfolder and manifests. In a fresh Windows workspace, choose that folder under **Settings → Data → External backup**, select the backup, restore it, and unlock it using the original workspace password. Restoring replaces the destination workspace and creates a safety backup first. Keep the source and backup until you have checked the restored pages.

Do not copy raw macOS Keychain or Windows DPAPI keys. Device encryption is tied to the source computer/user. Passwords and recovery keys are required to recover password-protected content.

## Optional native features

- **OCR:** uses installed Windows OCR languages. Add a language in Windows Settings if none is available.
- **Offline dictation:** uses an installed compatible Windows SAPI recognizer. Windows' built-in engine does not support every app language, including Brazilian Portuguese. A display-language pack alone does not add a SAPI recognizer. Audio is not sent to a cloud fallback.
- **Audio-file transcription:** optional; configure a local model, FFmpeg, and whisper-cli separately.
- **Windows Hello:** optional vault unlocking, available when Windows reports user verification support. Password unlocking remains available.
- **Apple integrations:** Apple Calendar, Reminders, Notes import, and Apple embeddings require macOS. WayNoted's own tasks, calendar views, and notes work on Windows.

## Agents and troubleshooting

Open **Settings → Local integrations** to authorize an agent and copy its MCP configuration. The included `resources\bin\workspace.exe` launcher uses the app's runtime and needs no separate Node.js installation. See [Local integrations](LOCAL-INTEGRATIONS.md).

If startup fails, preserve `%APPDATA%\WorkspaceData` and the original backup. Report the app version, Windows version, architecture, exact error, and reproduction steps in an [issue](https://github.com/cjpraia/WayNoted/issues). Do not attach your private profile, tokens, or passwords. Download `verification.json` from a release to inspect its automated installation and data-preservation checks.
