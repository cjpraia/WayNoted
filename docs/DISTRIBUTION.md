# Building and distribution

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
