import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RECENT_FILES_LIMIT,
  getRecentFiles,
  pushRecent,
  recordRecentFile,
  type RecentFile
} from '../src/renderer/lib/recentFiles.js'

// Map-backed localStorage stub — independent of Node's experimental builtin.
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, String(value)),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear()
})

function entry(relativePath: string): RecentFile {
  return {
    name: relativePath.split('/').pop() ?? relativePath,
    path: `/proj/${relativePath}`,
    relativePath
  }
}

describe('pushRecent', () => {
  it('prepends the newest entry', () => {
    const list = pushRecent([entry('a.md')], entry('b.md'))
    expect(list.map((item) => item.relativePath)).toEqual(['b.md', 'a.md'])
  })

  it('moves a re-opened file to the front without duplicating', () => {
    const list = pushRecent([entry('a.md'), entry('b.md')], entry('b.md'))
    expect(list.map((item) => item.relativePath)).toEqual(['b.md', 'a.md'])
  })

  it('caps the list at the limit', () => {
    let list: RecentFile[] = []
    for (let i = 0; i < RECENT_FILES_LIMIT + 5; i += 1) {
      list = pushRecent(list, entry(`${i}.md`))
    }
    expect(list.length).toBe(RECENT_FILES_LIMIT)
    expect(list[0].relativePath).toBe(`${RECENT_FILES_LIMIT + 4}.md`)
  })
})

describe('recordRecentFile / getRecentFiles', () => {
  beforeEach(() => {
    store.clear()
  })

  it('round-trips through localStorage with relative paths computed', () => {
    recordRecentFile('/proj', { name: 'intro.md', path: '/proj/docs/intro.md' })
    recordRecentFile('/proj', { name: 'a.md', path: '/proj/a.md' })
    const recents = getRecentFiles('/proj')
    expect(recents.map((item) => item.relativePath)).toEqual(['a.md', 'docs/intro.md'])
  })

  it('keeps projects separate and survives corrupted payloads', () => {
    recordRecentFile('/proj', { name: 'a.md', path: '/proj/a.md' })
    expect(getRecentFiles('/other')).toEqual([])
    localStorage.setItem('studio.recentFiles.v1:/broken', '{not json')
    expect(getRecentFiles('/broken')).toEqual([])
    localStorage.setItem('studio.recentFiles.v1:/badshape', JSON.stringify([{ nope: 1 }]))
    expect(getRecentFiles('/badshape')).toEqual([])
  })
})
