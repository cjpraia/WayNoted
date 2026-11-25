import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { captureSourceBuild, verifiedBuildInfo } from '../build/source-build-info.mjs'
import about from '../electron/about-info.cjs'

test('uses committed app code, ignores documentation and rejects a stale build after local edits', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'waynoted-build-info-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore', env: {
    ...process.env, GIT_AUTHOR_DATE: '2025-11-02T04:30:00Z', GIT_COMMITTER_DATE: '2025-11-02T04:30:00Z',
  } })
  git('init', '-q')
  mkdirSync(path.join(root, 'src'))
  const code = path.join(root, 'src', 'index.ts')
  writeFileSync(code, 'export const value = 1')
  git('add', '.')
  git('-c', 'user.email=example@example.com', '-c', 'user.name=Test', 'commit', '-qm', 'Update app code')
  writeFileSync(path.join(root, 'src', 'README.md'), 'Docs only')
  const clean = captureSourceBuild(root)
  assert.deepEqual(verifiedBuildInfo(clean, captureSourceBuild(root)), {
    updatedAt: '2025-11-02T04:30:00.000Z', builtAt: null, baseCommit: clean.baseCommit, commitSubject: 'Update app code', localChanges: false,
  })

  assert.match(clean.baseCommit, /^[a-f0-9]{8}$/)
  assert.equal(verifiedBuildInfo({ ...clean, builtAt: '2026-11-25T05:00:00.000Z' }, clean).builtAt, '2026-11-25T05:00:00.000Z')
  assert.equal(verifiedBuildInfo({ ...clean, baseCommit: '00000000' }, clean), null)

  writeFileSync(code, 'export const value = 2')
  const localTime = new Date('2025-11-03T01:09:00Z')
  utimesSync(code, localTime, localTime)
  const dirty = captureSourceBuild(root)
  assert.equal(verifiedBuildInfo(clean, dirty), null)
  assert.deepEqual(verifiedBuildInfo(dirty, captureSourceBuild(root)), {
    updatedAt: '2025-11-03T01:09:00.000Z', builtAt: null, baseCommit: clean.baseCommit, commitSubject: 'Update app code', localChanges: true,
  })

  renameSync(code, path.join(root, 'removed-file-fixture'))
  assert.deepEqual(verifiedBuildInfo(captureSourceBuild(root), captureSourceBuild(root)), {
    updatedAt: null, builtAt: null, baseCommit: clean.baseCommit, commitSubject: 'Update app code', localChanges: true,
  })
})

test('formats the packaged date in BRT across midnight and allows missing metadata', () => {
  assert.deepEqual(about.aboutInfo('1.0.6', { updatedAt: '2025-11-03T01:09:00.000Z', builtAt: '2025-11-03T03:12:00.000Z', baseCommit: '0123abcd', localChanges: true }), {
    version: '1.0.6', updated: { date: '02/11/2025', time: '22:09' }, built: { date: '03/11/2025', time: '00:12' }, baseCommit: '0123abcd', commitSubject: null, localChanges: true,
  })
  assert.deepEqual(about.aboutInfo('1.0.6', null), {
    version: '1.0.6', updated: null, built: null, baseCommit: null, commitSubject: null, localChanges: false,
  })
})
