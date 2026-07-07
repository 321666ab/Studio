import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { listProjectFiles } from '../src/main/fileService.js'

let root: string
let outside: string

beforeAll(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-listfiles-'))
  root = path.join(base, 'project')
  outside = path.join(base, 'outside')
  await fs.mkdir(path.join(root, 'docs', 'guides'), { recursive: true })
  await fs.mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true })
  await fs.mkdir(path.join(root, '.git'), { recursive: true })
  await fs.mkdir(outside, { recursive: true })

  await fs.writeFile(path.join(root, 'README.md'), '# hi')
  await fs.writeFile(path.join(root, 'docs', 'intro.md'), 'intro')
  await fs.writeFile(path.join(root, 'docs', 'guides', 'setup.md'), 'setup')
  await fs.writeFile(path.join(root, '.hidden'), 'dot')
  await fs.writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), 'x')
  await fs.writeFile(path.join(root, '.git', 'HEAD'), 'ref')
  await fs.writeFile(path.join(outside, 'secret.txt'), 'secret')
  // A symlinked directory must not be traversed (cycle / escape guard).
  await fs.symlink(outside, path.join(root, 'linked-dir'), 'dir')
})

afterAll(async () => {
  await fs.rm(path.dirname(root), { recursive: true, force: true })
})

describe('listProjectFiles', () => {
  it('lists nested files with root-relative paths, sorted', async () => {
    const entries = await listProjectFiles(root)
    const relative = entries.map((entry) => entry.relativePath)
    const expected = ['README.md', 'docs/guides/setup.md', 'docs/intro.md'].sort((a, b) =>
      a.localeCompare(b)
    )
    expect(relative).toEqual(expected)
  })

  it('excludes dotfiles, cache dirs, and symlinked directories', async () => {
    const entries = await listProjectFiles(root)
    const joined = entries.map((entry) => entry.relativePath).join('\n')
    expect(joined).not.toContain('.hidden')
    expect(joined).not.toContain('node_modules')
    expect(joined).not.toContain('.git')
    expect(joined).not.toContain('linked-dir')
    expect(joined).not.toContain('secret.txt')
  })

  it('returns absolute paths inside the root', async () => {
    const entries = await listProjectFiles(root)
    const realRoot = await fs.realpath(root)
    for (const entry of entries) {
      expect(path.isAbsolute(entry.path)).toBe(true)
      expect(entry.path.startsWith(realRoot + path.sep)).toBe(true)
      expect(entry.name).toBe(path.basename(entry.path))
    }
  })
})
