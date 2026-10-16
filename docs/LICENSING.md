# Licensing and third-party notices

## Project code

WayNoted's own code uses **PolyForm Noncommercial 1.0.0**. The complete terms are in [LICENSE](../LICENSE). License metadata lives in `shared/product.json`; `npm run configure` synchronizes it with `package.json` and the lockfile and copies the license to `clipper/LICENSE` for extension distribution. The app's English and Portuguese notices are in `src/legal.ts`.

The license permits use, modification, and redistribution for the noncommercial purposes it defines, with required terms and notices preserved. Commercial use requires separate permission from the rights holder; public distribution does not grant that permission.

The license expressly permits personal uses and uses by charitable organizations, educational institutions, public research organizations, and other listed entities. The full license defines permitted purposes; they are not determined only by whether money is charged. The restriction applies to the software and does not transfer rights in users' notes or other content to this project.

This is source-available software with a commercial restriction, not open source under the [OSI definition](https://opensource.org/osd). References: [official license](https://polyformproject.org/licenses/noncommercial/1.0.0) and [SPDX identifier](https://spdx.org/licenses/PolyForm-Noncommercial-1.0.0.html).

## Bundled dependencies

Each dependency retains its own license and notices. The noncommercial restriction on project code does not change rights granted by dependency authors. Component names, versions, sources, and license texts are collected in [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md). Preserve Electron's notices and its dependencies' notices in distributed bundles as well.

The BlockNote editor uses MPL-2.0. This project uses its public API and distributes library files unmodified. Future modifications to those files must be reviewed under that license. The project's own columns implementation is in `src/components/page/columns/`; it does not depend on the commercially/GPL-licensed XL package.

Fonts, icons, models, and binaries also require licenses compatible with distribution. Library licenses do not grant permission to use third-party trademarks as the product's brand.

## Checking licenses

```bash
node scripts/license-scan.mjs
node scripts/license-scan.mjs --notices
node scripts/license-scan.mjs --all
node scripts/license-scan.mjs --json
```

The scanner traverses app dependencies, identifies licenses, and flags incompatibilities, missing licenses, and terms requiring review. `--all` includes development tools. `--notices` regenerates the root notices file.

Run the scan when adding dependencies and before distributing a release. Review its output and applicable obligations; automated scanning does not replace license review.

## Interface and bundle

**Settings → About → Third-party notices and licenses** displays the app license and notices file. The main process reads a fixed path through `electron/notices-ipc.cjs`.

Before distribution, confirm that `LICENSE`, `THIRD-PARTY-NOTICES.md`, and Electron's notices are included in the final bundle. See [Distribution](DISTRIBUTION.md) for build and signing instructions.

## Windows native components

Windows packages also include the .NET runtime and System.Speech under their MIT licenses, the C#/WinRT runtime under MIT, and Windows SDK .NET projections governed by Microsoft Windows SDK terms. These components retain their respective licenses; the app's PolyForm license does not replace them. The original Windows SDK license and a readable text rendering are included with the native notices in `resources/native-licenses/`. The generated third-party notices also include those terms. Windows Setup displays both the original project license and the separate SDK terms; the root LICENSE is never rewritten. Source URLs are recorded in `native/windows/licenses/SOURCES.txt`.
