// Modify only the current user's PATH, only after an explicit app action.
const { execFile } = require('node:child_process')
const path = require('node:path')
const { promisify } = require('node:util')
const runFile = promisify(execFile)
const literal = value => "'" + String(value).replace(/'/g, "''") + "'"
async function userPath(binPath, action = 'status', run = runFile) {
  if (!['status', 'install', 'uninstall'].includes(action) || !path.win32.isAbsolute(binPath) || /[\0\r\n;]/.test(binPath)) throw new Error('CLI_INVALID_PATH')
  const directory = path.win32.dirname(binPath)
  const script = `$ErrorActionPreference='Stop'; $dir=${literal(directory)}; $key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment'); try { $old=[string]$key.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); $parts=@($old -split ';' | Where-Object { $_ }); $found=@($parts | Where-Object { $_.TrimEnd('\\') -ieq $dir.TrimEnd('\\') }).Count -gt 0; ${action === 'install' ? "if (!$found) { $key.SetValue('Path', (($parts + $dir) -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString) }" : action === 'uninstall' ? "$parts=@($parts | Where-Object { $_.TrimEnd('\\') -ine $dir.TrimEnd('\\') }); $key.SetValue('Path', ($parts -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)" : ''}; @{ installed=${action === 'install' ? '$true' : action === 'uninstall' ? '$false' : '$found'} } | ConvertTo-Json -Compress } finally { $key.Dispose() }`
  const { stdout } = await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 15000, maxBuffer: 64 * 1024 })
  const installed = JSON.parse(stdout.trim()).installed === true
  return { path: binPath, state: installed ? 'linked' : 'missing', directory, restartTerminal: action !== 'status' }
}
module.exports = { userPath, literal }
