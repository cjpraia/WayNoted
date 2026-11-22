import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const sourceStampFile = 'build-source.json'
const sources = [
  'src', 'electron', 'shared', 'clipper', 'native',
  'build', 'index.html', 'quick.html', 'vite.config.ts', 'package.json', 'package-lock.json',
  ':(exclude,glob)**/*.md', ':(exclude,glob)**/*.test.*', ':(exclude)native/windows',
  ':(exclude)build/native', ':(exclude)electron/gen', ':(exclude,glob)build/*windows*',
  ':(exclude)build/app-info.plist', ':(exclude)native/Info.plist',
  ':(exclude)clipper/identity.js', ':(exclude)clipper/LICENSE',
]

export function captureSourceBuild(root) {
  function git(...args) {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  }
  const names = output => output.split('\0').filter(Boolean)
  try {
    const [commit, seconds, ...subjectParts] = git('log', '-1', '--format=%H%n%ct%n%s', '--', ...sources).trimEnd().split('\n')
    if (!commit || !/^\d+$/.test(seconds ?? '')) return null
    const tracked = names(git('ls-files', '-z', '--', ...sources))
    const untracked = names(git('ls-files', '--others', '--exclude-standard', '-z', '--', ...sources))
    const changed = new Set([...names(git('diff', 'HEAD', '--name-only', '--no-renames', '-z', '--', ...sources)), ...untracked])
    const files = [...new Set([...tracked, ...changed])].sort()
    if (!files.length) return null

    const hash = createHash('sha256')
    const committedAt = Number(seconds) * 1000
    let newest = committedAt
    let dateKnown = true
    for (const name of files) {
      const file = path.join(root, name)
      const stat = fs.lstatSync(file, { throwIfNoEntry: false })
      if (!stat) {
        // Git can show an uncommitted deletion, but not when it happened.
        dateKnown = false
        hash.update(JSON.stringify([name, null]))
        continue
      }
      if (!stat.isFile()) return null
      const content = fs.readFileSync(file)
      hash.update(JSON.stringify([name, stat.mode & 0o111, content.length])).update(content)
      if (changed.has(name)) {
        if (!Number.isFinite(stat.mtimeMs) || stat.mtimeMs <= committedAt) dateKnown = false
        else newest = Math.max(newest, stat.mtimeMs)
      }
    }
    if (newest > Date.now()) dateKnown = false
    return {
      fingerprint: hash.update(commit).digest('hex'),
      updatedAt: dateKnown ? new Date(newest).toISOString() : null,
      commitSubject: subjectParts.join('\n') || null,
      localChanges: changed.size > 0,
    }
  } catch {
    return null
  }
}

export function verifiedBuildInfo(stamp, current) {
  if (!stamp || !current || stamp.fingerprint !== current.fingerprint) return null
  if (stamp.updatedAt !== current.updatedAt || stamp.localChanges !== current.localChanges ||
      stamp.commitSubject !== current.commitSubject) return null
  return { updatedAt: current.updatedAt, commitSubject: current.commitSubject, localChanges: current.localChanges }
}
