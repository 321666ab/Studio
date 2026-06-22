import { describe, expect, it } from 'vitest'
import { unifiedDiff } from '../src/main/diff.js'

describe('unifiedDiff', () => {
  it('returns empty string for identical input', () => {
    expect(unifiedDiff('a\nb\n', 'a\nb\n')).toBe('')
  })

  it('emits headers and a hunk for a single-line change', () => {
    const diff = unifiedDiff('a\nb\nc\n', 'a\nB\nc\n', 'file', 'file')
    expect(diff).toContain('--- file')
    expect(diff).toContain('+++ file')
    expect(diff).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/)
    expect(diff).toContain('-b')
    expect(diff).toContain('+B')
    expect(diff).toContain(' a')
    expect(diff).toContain(' c')
  })

  it('represents a pure addition', () => {
    const diff = unifiedDiff('', 'new line\n', '/dev/null', 'file')
    expect(diff).toContain('+new line')
    // No content-deletion lines (the `---` header is not a deletion).
    const body = diff.split('\n').filter((l) => !l.startsWith('---'))
    expect(body.some((l) => l.startsWith('-'))).toBe(false)
  })

  it('represents a pure deletion', () => {
    const diff = unifiedDiff('gone\n', '', 'file', '/dev/null')
    expect(diff).toContain('-gone')
  })

  it('keeps separate hunks for distant changes', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n')
    const afterLines = before.split('\n')
    afterLines[1] = 'CHANGED_TOP'
    afterLines[18] = 'CHANGED_BOTTOM'
    const diff = unifiedDiff(before, afterLines.join('\n'))
    const hunks = diff.match(/@@ /g) ?? []
    expect(hunks.length).toBe(2)
    expect(diff).toContain('+CHANGED_TOP')
    expect(diff).toContain('+CHANGED_BOTTOM')
  })
})
