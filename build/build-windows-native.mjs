import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
if (process.platform !== 'win32') throw new Error('Build Windows native resources on Windows with the .NET 8 SDK and MSVC tools.')
const arch = process.argv.find(value => value.startsWith('--arch='))?.split('=')[1] || process.env.WORKSPACE_TARGET_ARCH || process.arch
if (!['x64', 'arm64'].includes(arch)) throw new Error('Unsupported Windows architecture')
const output = path.join(root, 'build', 'native', 'win32-' + arch)
fs.mkdirSync(path.join(output, 'bin'), { recursive: true })
execFileSync('dotnet', ['publish', 'native/windows/WorkspaceNative.csproj', '-c', 'Release', '-r', 'win-' + arch, '-o', output, '--self-contained', 'true'], { cwd: root, stdio: 'inherit' })
execFileSync('cl.exe', ['/nologo', '/std:c++17', '/EHsc', '/MT', '/O2', 'native/windows/launcher.cpp', '/Fe:' + path.join(output, 'bin', 'workspace.exe'), '/Fo:' + path.join(output, 'launcher.obj')], { cwd: root, stdio: 'inherit' })
fs.rmSync(path.join(output, 'launcher.obj'), { force: true })
