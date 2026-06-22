import { describe, expect, it } from 'vitest'
import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import {
  isExcludedDir,
  prepareWorkspace,
  toPosix,
  WORKSPACE_EXCLUDED_DIRS
} from '../src/main/workspace.js'

const execFileAsync = promisify(execFile)

describe('isExcludedDir', () => {
  it('excludes dangerous/cache dot directories without hiding tracked config', () => {
    expect(isExcludedDir('.git')).toBe(true)
    expect(isExcludedDir('.cache')).toBe(true)
    expect(isExcludedDir('.github')).toBe(false)
    expect(isExcludedDir('.husky')).toBe(false)
    expect(isExcludedDir('.vscode')).toBe(false)
  })

  it('excludes known build/cache directories', () => {
    for (const name of WORKSPACE_EXCLUDED_DIRS) {
      expect(isExcludedDir(name)).toBe(true)
    }
    expect(isExcludedDir('node_modules')).toBe(true)
    expect(isExcludedDir('dist')).toBe(true)
  })

  it('keeps ordinary source directories', () => {
    expect(isExcludedDir('src')).toBe(false)
    expect(isExcludedDir('lib')).toBe(false)
  })
})

describe('toPosix', () => {
  it('passes through posix paths unchanged', () => {
    expect(toPosix('a/b/c.txt')).toBe('a/b/c.txt')
  })
})

describe('prepareWorkspace', () => {
  it('preserves tracked deletions when mirroring a dirty git worktree', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-workspace-test-'))
    try {
      await execFileAsync('git', ['init'], { cwd: root })
      await fs.writeFile(path.join(root, 'keep.txt'), 'keep')
      await fs.writeFile(path.join(root, 'deleted.txt'), 'delete me')
      await fs.mkdir(path.join(root, '.github'))
      await fs.writeFile(path.join(root, '.github', 'workflow.yml'), 'name: test')
      await execFileAsync('git', ['add', '.'], { cwd: root })
      await execFileAsync(
        'git',
        ['-c', 'user.name=Studio Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'base'],
        { cwd: root }
      )
      await fs.rm(path.join(root, 'deleted.txt'))

      const workspace = await prepareWorkspace(root)
      try {
        await expect(fs.stat(path.join(workspace.path, 'keep.txt'))).resolves.toBeDefined()
        await expect(fs.stat(path.join(workspace.path, 'deleted.txt'))).rejects.toThrow()
        await expect(
          fs.readFile(path.join(workspace.path, '.github', 'workflow.yml'), 'utf-8')
        ).resolves.toBe('name: test')
      } finally {
        await workspace.cleanup()
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
