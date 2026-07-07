/**
 * Lightweight fuzzy matcher for the quick-open palette. Greedy subsequence
 * match with a score that prefers: matches at word/path boundaries, runs of
 * consecutive characters, matches inside the basename, and shorter targets.
 */

export interface FuzzyMatch {
  score: number
  /** Indices into `target` of the matched characters, ascending. */
  positions: number[]
}

const BOUNDARY_CHARS = new Set(['/', '\\', '-', '_', '.', ' '])

function isBoundary(target: string, index: number): boolean {
  if (index === 0) return true
  const prev = target[index - 1]
  if (BOUNDARY_CHARS.has(prev)) return true
  // camelCase transition: lower/digit followed by upper.
  const current = target[index]
  return current >= 'A' && current <= 'Z' && !(prev >= 'A' && prev <= 'Z')
}

/**
 * Match `query` as a case-insensitive subsequence of `target`. Returns null
 * when the query does not fully match. An empty query matches with score 0.
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  if (!query) return { score: 0, positions: [] }
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (q.length > t.length) return null

  const positions: number[] = []
  let score = 0
  let ti = 0
  let lastMatch = -2

  const lastSlash = Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\'))

  for (let qi = 0; qi < q.length; qi += 1) {
    const idx = t.indexOf(q[qi], ti)
    if (idx === -1) return null
    positions.push(idx)

    let charScore = 1
    if (idx === lastMatch + 1) charScore += 6 // consecutive run
    if (isBoundary(target, idx)) charScore += 8 // word / path-segment start
    if (idx > lastSlash) charScore += 4 // inside the basename
    if (target[idx] === query[qi]) charScore += 1 // exact case
    // Penalize the gap skipped to reach this character.
    charScore -= Math.min(idx - (lastMatch + 1), 5) * 0.5

    score += charScore
    lastMatch = idx
    ti = idx + 1
  }

  // Prefer compact matches and shorter targets overall.
  const spread = positions[positions.length - 1] - positions[0] + 1
  score += Math.max(0, 12 - (spread - q.length))
  score -= target.length * 0.02
  // Strong bonus when the match starts exactly at the basename.
  if (positions[0] === lastSlash + 1) score += 10

  return { score, positions }
}

export interface RankedItem<T> {
  item: T
  match: FuzzyMatch
}

/**
 * Rank `items` against `query`, dropping non-matches and sorting by score
 * (desc), then by the extracted text (asc) for stability. At most `limit`
 * results are returned. `getBoost` adds a per-item score offset (e.g. to
 * float recently used items) without affecting the highlight positions.
 */
export function rankFuzzy<T>(
  query: string,
  items: readonly T[],
  getText: (item: T) => string,
  limit: number,
  getBoost?: (item: T) => number
): Array<RankedItem<T>> {
  const ranked: Array<RankedItem<T>> = []
  for (const item of items) {
    const match = fuzzyMatch(query, getText(item))
    if (match) {
      const boost = getBoost?.(item) ?? 0
      ranked.push(
        boost ? { item, match: { ...match, score: match.score + boost } } : { item, match }
      )
    }
  }
  ranked.sort((a, b) => {
    if (b.match.score !== a.match.score) return b.match.score - a.match.score
    return getText(a.item).localeCompare(getText(b.item))
  })
  return ranked.slice(0, limit)
}
