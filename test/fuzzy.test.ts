import { describe, expect, it } from 'vitest'
import { fuzzyMatch, rankFuzzy } from '../src/renderer/lib/fuzzy.js'

describe('fuzzyMatch', () => {
  it('matches an empty query with score 0', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, positions: [] })
  })

  it('matches a case-insensitive subsequence', () => {
    const match = fuzzyMatch('rdme', 'README.md')
    expect(match).not.toBeNull()
    // Greedy forward scan: R, then d/m/e inside "ADME".
    expect(match!.positions).toEqual([0, 3, 4, 5])
  })

  it('returns null when a character is missing', () => {
    expect(fuzzyMatch('xyz', 'README.md')).toBeNull()
    expect(fuzzyMatch('longerquery', 'short')).toBeNull()
  })

  it('prefers basename matches over directory matches', () => {
    const inBasename = fuzzyMatch('types', 'src/shared/types.ts')!
    const inDirectory = fuzzyMatch('types', 'types/deep/nested/other.ts')!
    expect(inBasename.score).toBeGreaterThan(0)
    expect(inDirectory.score).toBeGreaterThan(0)
    // Both match, but ranking must surface the basename hit first.
    const ranked = rankFuzzy(
      'types',
      ['types/deep/nested/other.ts', 'src/shared/types.ts'],
      (item) => item,
      10
    )
    expect(ranked[0].item).toBe('src/shared/types.ts')
  })

  it('prefers consecutive runs over scattered matches', () => {
    const consecutive = fuzzyMatch('app', 'src/App.tsx')!
    const scattered = fuzzyMatch('app', 'a-super-long-path-plan.md')!
    expect(consecutive.score).toBeGreaterThan(scattered.score)
  })

  it('rewards word and path-segment boundaries', () => {
    const boundary = fuzzyMatch('fs', 'file-service.ts')!
    const middle = fuzzyMatch('fs', 'offset.ts')!
    expect(boundary.score).toBeGreaterThan(middle.score)
  })
})

describe('rankFuzzy', () => {
  const files = [
    'src/main/index.ts',
    'src/renderer/App.tsx',
    'src/renderer/components/Sidebar.tsx',
    'README.md',
    'package.json'
  ]

  it('drops non-matching items and respects the limit', () => {
    const ranked = rankFuzzy('src', files, (item) => item, 2)
    expect(ranked.length).toBe(2)
    for (const entry of ranked) expect(entry.item.startsWith('src/')).toBe(true)
  })

  it('returns an exact filename as the top hit', () => {
    const ranked = rankFuzzy('app', files, (item) => item, 10)
    expect(ranked[0].item).toBe('src/renderer/App.tsx')
  })

  it('sorts ties stably by text', () => {
    const ranked = rankFuzzy('', ['b', 'a'], (item) => item, 10)
    // Empty query keeps score 0 for everything; order falls back to text.
    expect(ranked.map((entry) => entry.item)).toEqual(['a', 'b'])
  })

  it('lets a boost reorder otherwise-similar matches', () => {
    const items = ['notes/one.md', 'notes/two.md']
    const plain = rankFuzzy('notes', items, (item) => item, 10)
    expect(plain[0].item).toBe('notes/one.md')
    const boosted = rankFuzzy('notes', items, (item) => item, 10, (item) =>
      item === 'notes/two.md' ? 50 : 0
    )
    expect(boosted[0].item).toBe('notes/two.md')
  })
})
