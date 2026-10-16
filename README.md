# WayNoted

A local notes and database app for macOS and Windows. Organize pages with a block editor, databases with relations and rollups, live queries, object types, a canvas, tasks, and daily notes. AI and agent integrations are optional.

Your data stays on your computer. No account, built-in cloud sync, or telemetry is required. Optional cloud AI, remote content, and manual update checks have separate controls; see [Security and privacy](docs/SECURITY.md).

The interface supports **English and Brazilian Portuguese**. New installations start in English; existing language preferences are preserved. Change the language in **Settings → My account**.

## Download for Windows

Download the installer for your Windows 11 computer:

| Computer | Installer |
|---|---|
| Intel or AMD (most PCs) | [Windows x64](https://github.com/cjpraia/WayNoted/releases/latest/download/WayNoted-Setup-1.0.1-win-x64.exe) |
| ARM, including Snapdragon PCs | [Windows ARM64](https://github.com/cjpraia/WayNoted/releases/latest/download/WayNoted-Setup-1.0.1-win-arm64.exe) |

Run Setup, then open **WayNoted** from Start. No developer tools, Node.js, .NET installation, or account are needed. These installers are unsigned: Windows may show an unknown-publisher warning, and managed PCs or Smart App Control may block unsigned applications. See the [Windows installation guide](docs/WINDOWS.md) for installation, updates, backups, and supported features. Checksums and verification reports are on the [release page](https://github.com/cjpraia/WayNoted/releases/latest).

## Development setup

For development, use Node.js 24 and npm. macOS builds require Apple Silicon and Xcode Command Line Tools; some native features require macOS 14 or later. Windows builds target Windows 11 x64 and ARM64 and require the .NET 10 SDK and Visual Studio C++ Build Tools. Installed Windows builds include the runtimes; users do not need Node.js or .NET.

```bash
git clone https://github.com/cjpraia/WayNoted.git
cd WayNoted
npm install
npm run dev        # React interface + Electron
npm run typecheck
npm test
npm run dist       # macOS arm64 application bundle
# On Windows, from a Visual Studio Developer PowerShell:
npm run dist:win   # x64 Setup executable
# npm run dist:win:arm64  # ARM64 Setup executable
```

To rebuild and launch the app, run `./scripts/launch.command`. The bundle is created at `release/Desktop-darwin-arm64/Desktop.app`. `npm run dev:web` runs only the interface, without native integrations. See [Distribution](docs/DISTRIBUTION.md) for signing and release limitations.

## Documentation

| Guide | Contents |
|---|---|
| [Usage](docs/USAGE.md) | Pages, databases, templates, canvas, files, and accessibility |
| [Keyboard shortcuts](docs/KEYBOARD-SHORTCUTS.md) | Navigation, editing, and customization |
| [Live queries](docs/QUERIES.md) | Visual builder and English/Portuguese query syntax |
| [Local integrations](docs/LOCAL-INTEGRATIONS.md) | API, CLI, MCP, agents, webhooks, and web clipper |
| [AI](docs/AI.md) | Providers, context, and privacy |
| [Security](docs/SECURITY.md) | Storage, passwords, Keychain, caches, and backups |
| [Development](docs/DEVELOPMENT.md) | Project structure, tests, and product identity |
| [Distribution](docs/DISTRIBUTION.md) | Builds, signing, and updates |
| [Licensing](docs/LICENSING.md) | Project license and third-party notices |

Windows x64 and ARM64 installers are built and exercised on Windows CI, including an upgrade from the previous application version and restoration of a password-protected backup generated on macOS. See [Distribution](docs/DISTRIBUTION.md#windows-builds) for the build and verification process.

## Contributing

**Pull requests are welcome.** Bug reports, fixes, documentation improvements, translations, and accessibility improvements are all useful. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks, and the pull request process. Please write public issues, pull requests, and documentation in English.

## Product identity

The public app name is defined in `shared/product.json`. Internal paths and identifiers use generic names so changing the brand does not break existing installations. Run `npm run configure` after changing the product record.

## Data and license

The default profile is `~/Library/Application Support/WorkspaceData/` on macOS and `%APPDATA%\WorkspaceData` on Windows. Portable backups and exports may contain readable data. Password-protected data cannot be recovered without the password or recovery key.

WayNoted's own code is distributed under the [PolyForm Noncommercial License 1.0.0](LICENSE). Use, modification, and redistribution are permitted for the noncommercial purposes defined in that license. Commercial use requires separate permission from the rights holder.

This is source-available software; the commercial restriction means it is not open source under the OSI definition. Dependencies retain their own licenses, collected in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). See [Licensing](docs/LICENSING.md) for details.
