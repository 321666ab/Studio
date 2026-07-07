import { describe, expect, it, vi } from 'vitest'

// clipboardFiles imports electron at module top; vitest cannot resolve the
// electron runtime, so stub the piece the pure helper never touches.
vi.mock('electron', () => ({
  clipboard: { writeText: vi.fn(), writeBuffer: vi.fn() }
}))

const { filenamesPboardPlist } = await import('../src/main/clipboardFiles.js')

describe('filenamesPboardPlist', () => {
  it('wraps a single absolute path in a plist array', () => {
    const plist = filenamesPboardPlist(['/tmp/文件 A.pdf'])
    expect(plist.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(plist).toContain('<plist version="1.0"><array>')
    expect(plist).toContain('<string>/tmp/文件 A.pdf</string>')
    expect(plist.endsWith('</array></plist>')).toBe(true)
  })

  it('keeps multiple paths in order', () => {
    const plist = filenamesPboardPlist(['/a/1.txt', '/b/2.txt'])
    expect(plist.indexOf('/a/1.txt')).toBeLessThan(plist.indexOf('/b/2.txt'))
  })

  it('escapes XML metacharacters in paths', () => {
    const plist = filenamesPboardPlist([`/tmp/a&b<c>d"e'f.txt`])
    expect(plist).toContain('<string>/tmp/a&amp;b&lt;c&gt;d&quot;e&apos;f.txt</string>')
    expect(plist).not.toContain('a&b')
  })
})
