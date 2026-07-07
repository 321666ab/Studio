import { describe, expect, it } from 'vitest'
import path from 'path'
import { changedDirFor } from '../src/main/fsWatcher.js'

const root = path.join(path.sep, 'tmp', 'proj')

describe('changedDirFor', () => {
  it('maps a file event to its parent directory', () => {
    expect(changedDirFor(root, path.join('docs', 'intro.md'))).toBe(path.join(root, 'docs'))
    expect(changedDirFor(root, 'README.md')).toBe(root)
  })

  it('falls back to the root for missing or empty filenames', () => {
    expect(changedDirFor(root, null)).toBe(root)
    expect(changedDirFor(root, '')).toBe(root)
  })

  it('drops events inside ignored subtrees and for ignored entries', () => {
    expect(changedDirFor(root, path.join('node_modules', 'pkg', 'index.js'))).toBeNull()
    expect(changedDirFor(root, path.join('.git', 'HEAD'))).toBeNull()
    expect(changedDirFor(root, path.join('docs', '.DS_Store'))).toBeNull()
    expect(changedDirFor(root, '.hidden')).toBeNull()
    expect(changedDirFor(root, path.join('dist', 'bundle.js'))).toBeNull()
  })

  it('keeps events for visible nested paths', () => {
    expect(changedDirFor(root, path.join('src', 'lib', 'a.ts'))).toBe(
      path.join(root, 'src', 'lib')
    )
  })
})
