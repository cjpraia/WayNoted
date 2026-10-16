import { packager } from '@electron/packager'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import PRODUCT from '../shared/product.json' with { type: 'json' }
import COMPAT from '../shared/compatibility.mjs'
const test = process.argv.includes('--test')
const out = test ? 'release-test' : 'release'
const paths = await packager({
  dir: '.', name: PRODUCT.executable, executableName: PRODUCT.executable,
  platform: 'darwin', arch: 'arm64', out, overwrite: true, icon: 'build/icon.icns', prune: false,
  appBundleId: PRODUCT.bundleId + (test ? '.test' : ''), extendInfo: 'build/app-info.plist',
  protocols: [{ name: PRODUCT.name, schemes: [PRODUCT.protocol, COMPAT.previousProtocol, ...(PRODUCT.protocolAliases ?? [])] }],
  extraResource: ['build/native/workspace-native', 'build/bin'],
  ignore: /^\/(src|docs|tests|release|release-test|build|native|node_modules|\.artifacts|\.git|\.claude|tsconfig\.json|vite\.config\.ts|index\.html|package-lock\.json|\.gitignore)($|\/)/,
})
for (const directory of paths) {
  const app = directory.endsWith('.app') ? directory : path.join(directory, PRODUCT.executable + '.app')
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
