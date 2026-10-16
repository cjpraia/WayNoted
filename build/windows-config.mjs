import PRODUCT from '../shared/product.json' with { type: 'json' }
import COMPAT from '../shared/compatibility.mjs'
export function windowsConfig({ arch = 'x64', test = false, signed = process.env.WORKSPACE_REQUIRE_SIGNING === '1' } = {}) {
  if (!['x64', 'arm64'].includes(arch)) throw new Error('Unsupported Windows architecture')
  return {
    extraMetadata: { workspaceTestBuild: test },
    appId: PRODUCT.bundleId + (test ? '.test' : ''), productName: PRODUCT.name + (test ? ' Test' : ''), executableName: PRODUCT.executable,
    directories: { output: test ? 'release-test' : 'release', buildResources: 'build' },
    artifactName: `${PRODUCT.name}-Setup-\${version}-win-${arch}.exe`,
    protocols: test ? [] : [{ name: PRODUCT.name, schemes: [PRODUCT.protocol, COMPAT.previousProtocol, ...(PRODUCT.protocolAliases ?? [])] }],
    win: { target: [{ target: 'nsis', arch: [arch] }], icon: 'build/icon.ico', forceCodeSigning: signed, requestedExecutionLevel: 'asInvoker', signAndEditExecutable: true, verifyUpdateCodeSignature: true },
    nsis: { guid: test ? 'b99e4fc0-c30e-4a84-9cff-e191c4b1bc54' : 'e2ee0589-6729-419e-9ca9-728f4a5de48d', oneClick: false, perMachine: false, allowElevation: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: false, createStartMenuShortcut: true, shortcutName: PRODUCT.name + (test ? ' Test' : ''), uninstallDisplayName: PRODUCT.name + (test ? ' Test' : ''), deleteAppDataOnUninstall: false, include: test ? 'build/windows-test-installer.nsh' : 'build/windows-installer.nsh', license: 'build/windows-license.txt', runAfterFinish: false },
    afterPack: async context => {
      // Extra-resource executables are outside app.asar and need explicit signing.
      for (const relative of ['resources/workspace-native.exe', 'resources/bin/workspace.exe']) await context.packager.signIf((await import('node:path')).join(context.appOutDir, relative))
    },
    publish: null,
  }
}
