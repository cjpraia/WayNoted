import { packager } from '@electron/packager'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import PRODUCT from '../shared/product.json' with { type: 'json' }
import COMPAT from '../shared/compatibility.mjs'
const test = process.argv.includes('--test')
const out = test ? 'release-test' : 'release'
const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=')[1]
const platform = argument('platform') || process.platform
const arch = argument('arch') || process.arch
if (!['darwin', 'win32'].includes(platform) || !['arm64', 'x64'].includes(arch)) throw new Error('Unsupported package target')
if (platform === 'win32' && process.platform !== 'win32') throw new Error('Build Windows packages on Windows, including the native helper and CLI launcher.')
if (platform === 'win32') await import('./build-windows-icon.mjs')
const nativeDirectory = platform === 'win32' ? path.join('build', 'native', 'win32-' + arch) : path.join('build', 'native')
const nativeFile = path.join(nativeDirectory, platform === 'win32' ? 'workspace-native.exe' : 'workspace-native')
if (!fs.existsSync(nativeFile)) throw new Error('Native helper missing; run npm run build:native for the target architecture.')
if (platform === 'win32') {
  const { build, Platform, Arch } = await import('electron-builder')
  const { windowsConfig } = await import('./windows-config.mjs')
  await build({ targets: Platform.WINDOWS.createTarget(['nsis'], arch === 'arm64' ? Arch.arm64 : Arch.x64), config: {
    ...windowsConfig({ arch, test }),
    npmRebuild: false,
    files: ['dist/**/*', 'electron/**/*', 'shared/**/*', 'clipper/**/*', 'package.json', 'LICENSE', 'THIRD-PARTY-NOTICES.md'],
    extraResources: [{ from: nativeFile, to: 'workspace-native.exe' }, { from: path.join(nativeDirectory, 'bin'), to: 'bin' }, { from: path.join(nativeDirectory, 'native-licenses'), to: 'native-licenses' }],
  } })
} else {
const paths = await packager({
  dir: '.', name: PRODUCT.executable, executableName: PRODUCT.executable,
  platform, arch, out, overwrite: true, icon: platform === 'win32' ? 'build/icon.ico' : 'build/icon.icns', prune: false,
  ...(platform === 'darwin' ? { appBundleId: PRODUCT.bundleId + (test ? '.test' : ''), extendInfo: 'build/app-info.plist' } : {}),
  protocols: [{ name: PRODUCT.name, schemes: [PRODUCT.protocol, COMPAT.previousProtocol, ...(PRODUCT.protocolAliases ?? [])] }],
  extraResource: [nativeFile, ...(platform === 'win32' ? [path.join(nativeDirectory, 'bin'), path.join(nativeDirectory, 'native-licenses')] : ['build/bin'])],
  ignore: /^\/(src|docs|tests|release|release-test|build|native|node_modules|\.artifacts|\.git|\.claude|tsconfig\.json|vite\.config\.ts|index\.html|package-lock\.json|\.gitignore)($|\/)/,
})
for (const directory of paths) {
  const app = directory.endsWith('.app') ? directory : path.join(directory, PRODUCT.executable + '.app')
  if (test) {
    const metadataPath = path.join(app, 'Contents', 'Resources', 'app', 'package.json')
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    fs.writeFileSync(metadataPath, JSON.stringify({ ...metadata, workspaceTestBuild: true }, null, 2))
  }
  const plist = `${app}/Contents/Info.plist`
  // Electron checks its default Helper paths before the public CFBundleName.
  // Restore those neutral paths so the menu can use the brand independently.
  const frameworks = path.join(app, 'Contents', 'Frameworks')
  for (const entry of fs.readdirSync(frameworks)) {
    if (!entry.startsWith(PRODUCT.executable + ' Helper') || !entry.endsWith('.app')) continue
    const previous = entry.slice(0, -4)
    const neutral = 'Electron' + previous.slice(PRODUCT.executable.length)
    const directory = path.join(frameworks, entry)
    fs.renameSync(path.join(directory, 'Contents', 'MacOS', previous), path.join(directory, 'Contents', 'MacOS', neutral))
    for (const key of ['CFBundleName', 'CFBundleDisplayName', 'CFBundleExecutable']) execFileSync('plutil', ['-replace', key, '-string', neutral, path.join(directory, 'Contents', 'Info.plist')])
    fs.renameSync(directory, path.join(frameworks, neutral + '.app'))
  }
  for (const key of ['CFBundleName', 'CFBundleDisplayName']) execFileSync('plutil', ['-replace', key, '-string', PRODUCT.name, plist])
  execFileSync(process.execPath, ['build/sign-app.mjs', app], { stdio: 'inherit', env: { ...process.env, ...(test ? { WORKSPACE_ALLOW_TEST_BUNDLE: '1' } : {}) } })
}
}
