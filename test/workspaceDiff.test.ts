import { describe, expect, it } from 'vitest'
import {
  computeChanges,
  decideApply,
  hashBuffer,
  looksBinary,
  snapshotFromBuffer,
  type SnapshotMap
} from '../src/main/workspaceDiff.js'
import { buildTaskPrompt, selectChanges } from '../src/main/agentTaskManager.js'

function snap(text: string): ReturnType<typeof snapshotFromBuffer> {
  return snapshotFromBuffer(Buffer.from(text, 'utf-8'))
}

describe('looksBinary', () => {
  it('flags buffers containing a NUL byte', () => {
    expect(looksBinary(Buffer.from([1, 2, 0, 3]))).toBe(true)
  })
  it('treats text as non-binary', () => {
    expect(looksBinary(Buffer.from('hello world', 'utf-8'))).toBe(false)
  })
})

describe('computeChanges', () => {
  it('detects added, modified, and deleted files', () => {
    const baseline: SnapshotMap = new Map([
      ['keep.txt', snap('same')],
      ['mod.txt', snap('old')],
      ['gone.txt', snap('bye')]
    ])
    const current: SnapshotMap = new Map([
      ['keep.txt', snap('same')],
      ['mod.txt', snap('new')],
      ['added.txt', snap('hi')]
    ])
    const changes = computeChanges(baseline, current)
    const byPath = Object.fromEntries(changes.map((c) => [c.path, c]))

    expect(Object.keys(byPath).sort()).toEqual(['added.txt', 'gone.txt', 'mod.txt'])
    expect(byPath['added.txt'].changeType).toBe('added')
    expect(byPath['added.txt'].baselineHash).toBeNull()
    expect(byPath['mod.txt'].changeType).toBe('modified')
    expect(byPath['gone.txt'].changeType).toBe('deleted')
    expect(byPath['gone.txt'].currentHash).toBeNull()
  })

  it('skips quadratic diff generation for very large line matrices', () => {
    const before = `${Array.from({ length: 2500 }, (_, i) => `before-${i}`).join('\n')}\n`
    const after = `${Array.from({ length: 2500 }, (_, i) => `after-${i}`).join('\n')}\n`
    const baseline = new Map([['large.txt', snapshotFromBuffer(Buffer.from(before))]])
    const current = new Map([['large.txt', snapshotFromBuffer(Buffer.from(after))]])
    expect(computeChanges(baseline, current)[0].diff).toBeUndefined()
  })

  it('produces a unified diff for modified text files', () => {
    const baseline: SnapshotMap = new Map([['a.txt', snap('line1\nline2\n')]])
    const current: SnapshotMap = new Map([['a.txt', snap('line1\nCHANGED\n')]])
    const [change] = computeChanges(baseline, current)
    expect(change.diff).toContain('-line2')
    expect(change.diff).toContain('+CHANGED')
  })

  it('omits diffs for binary files but still hashes them', () => {
    const bin = snapshotFromBuffer(Buffer.from([0, 1, 2, 0]))
    const bin2 = snapshotFromBuffer(Buffer.from([0, 9, 9, 0]))
    const changes = computeChanges(new Map([['x.bin', bin]]), new Map([['x.bin', bin2]]))
    expect(changes[0].binary).toBe(true)
    expect(changes[0].diff).toBeUndefined()
    expect(changes[0].currentHash).toBe(bin2.hash)
  })

  it('returns no changes when snapshots match', () => {
    const map: SnapshotMap = new Map([['a', snap('x')]])
    expect(computeChanges(map, new Map([['a', snap('x')]]))).toEqual([])
  })
})

describe('decideApply', () => {
  const baseline = hashBuffer(Buffer.from('baseline'))

  it('applies a modification when source still matches baseline', () => {
    expect(decideApply(baseline, baseline)).toEqual({ apply: true })
  })

  it('blocks a modification when source drifted from baseline', () => {
    const drift = hashBuffer(Buffer.from('drifted'))
    expect(decideApply(baseline, drift)).toEqual({
      apply: false,
      reason: 'baseline-changed'
    })
  })

  it('blocks when the source file is now missing', () => {
    expect(decideApply(baseline, null)).toEqual({ apply: false, reason: 'missing' })
  })

  it('applies an addition when no source file exists', () => {
    expect(decideApply(null, null)).toEqual({ apply: true })
  })

  it('blocks an addition that would clobber a pre-existing source file', () => {
    const existing = hashBuffer(Buffer.from('surprise'))
    expect(decideApply(null, existing)).toEqual({
      apply: false,
      reason: 'baseline-changed'
    })
  })
})

describe('selectChanges', () => {
  const changes = [
    { path: 'a.txt' },
    { path: 'b.txt' },
    { path: 'c.txt' }
  ] as Parameters<typeof selectChanges>[0]

  it('returns everything when no paths given', () => {
    expect(selectChanges(changes)).toHaveLength(3)
    expect(selectChanges(changes, [])).toHaveLength(3)
  })

  it('filters to the requested subset', () => {
    const result = selectChanges(changes, ['a.txt', 'c.txt'])
    expect(result.map((c) => c.path)).toEqual(['a.txt', 'c.txt'])
  })
})

describe('buildTaskPrompt', () => {
  it('invokes a Claude skill exactly once and lists scoped context', () => {
    const prompt = buildTaskPrompt(
      '检查日期',
      {
        id: 'project:review',
        command: '/review',
        source: 'project',
        name: 'Review'
      },
      ['docs/a.md', 'docs/b.md']
    )
    expect(prompt.match(/\/review/g)).toHaveLength(1)
    expect(prompt).toContain('- docs/a.md')
    expect(prompt).toContain('- docs/b.md')
  })
})
