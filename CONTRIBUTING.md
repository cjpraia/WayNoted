# Contributing to WayNoted

**We welcome pull requests.** You can help with bug fixes, documentation, translations, accessibility, tests, and focused feature improvements.

Please write issues, pull request descriptions, and documentation in English. The interface supports English and Brazilian Portuguese; include both translations when changing user-facing text.

## Before you start

- Search existing [issues](https://github.com/cjpraia/WayNoted/issues) and [pull requests](https://github.com/cjpraia/WayNoted/pulls) to avoid duplicate work.
- For a large feature, storage change, or new dependency, open an issue to discuss the approach before building it.
- For a small fix or documentation improvement, a pull request is enough.
- Read [LICENSE](LICENSE). The project uses PolyForm Noncommercial 1.0.0, not a permissive open-source license. Submit original contributions under the same license and identify any third-party code and its license. You retain copyright in your contributions.

## Development setup

1. Fork the repository and clone your fork.
2. Install Node.js 24 and npm. For native builds use Xcode Command Line Tools on Apple Silicon macOS, or .NET 10 SDK and Visual Studio C++ Build Tools on Windows. See the platform setup in [Development](docs/DEVELOPMENT.md).
3. Run:

```bash
npm install
npm run dev
```

Use a topic branch for your change. See [Development](docs/DEVELOPMENT.md) for the project structure and native testing workflow. `npm run dev:web` is useful for interface work but cannot validate native storage or OS integrations.

## Making a change

Keep each pull request focused on one problem. Follow the surrounding code style and reuse existing UI components, icons, and design tokens.

- Keep the public product identity in `shared/product.json`; use generic internal paths and identifiers.
- Preserve compatibility identifiers and storage formats. Never rename them just to match branding.
- Preserve keyboard navigation, accessible names, and both interface languages.
- Use temporary profiles and sample data for testing. Never commit personal notes, profiles, backups, API tokens, credentials, signing certificates, or private keys.
- Update the relevant guide in `docs/` when behavior changes. Temporary reports and screenshots belong in the ignored `.artifacts/` directory.
- Add or update tests when they meaningfully cover a behavior change or regression. Documentation-only changes do not need new tests.

## Checks

```bash
npm run typecheck
npm test
```

During development, run a focused test with:

```bash
node scripts/run-tests.mjs tests/workspace.test.mts
```

For a native or packaging change, also run `npm run dist` on macOS or `npm run dist:win` / `npm run dist:win:arm64` on Windows and test the resulting app with a temporary profile. Describe any OS permissions or hardware needed to reproduce your result.

For a dependency change, review its license and regenerate notices:

```bash
node scripts/license-scan.mjs --notices
```

Include any required notice updates. See [Licensing](docs/LICENSING.md) and [Security](docs/SECURITY.md).

## Submitting a pull request

Open a pull request against `main`. Explain:

- The problem and the resulting behavior.
- What changed and any compatibility or data migration implications.
- Which checks you ran and their results; state clearly what you could not test.
- Screenshots or a short recording for visible interface changes, using sample data.

Link the related issue when one exists. Maintainers may request changes before merging; submitting a pull request does not guarantee acceptance.

## Reporting bugs and security concerns

For a bug, include the app version, OS version and architecture, reproduction steps, expected behavior, and actual behavior. Remove personal data and secrets from logs and screenshots.

For a security vulnerability, use the repository's private **Report a vulnerability** option if available. Otherwise, open an issue requesting a private contact without publishing exploit details or sensitive information.
