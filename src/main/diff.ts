/**
 * Minimal unified-diff generator for text files. Uses an LCS over lines, which
 * is adequate for the file sizes we diff (agent edits, not multi-megabyte
 * blobs). Output matches the `diff -u` hunk format closely enough for display.
 */

/** Split text into lines. An empty string yields no lines. */
function splitLines(text: string): string[] {
  if (text === '') return []
  return text.split('\n')
}

/** Length matrix for the longest common subsequence of two line arrays. */
function lcsMatrix(a: string[], b: string[]): number[][] {
  const rows = a.length + 1
  const cols = b.length + 1
  const matrix: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      matrix[i][j] =
        a[i] === b[j]
          ? matrix[i + 1][j + 1] + 1
          : Math.max(matrix[i + 1][j], matrix[i][j + 1])
    }
  }
  return matrix
}

/** A single diff operation, tagged with its 0-based line numbers in each side. */
interface Op {
  type: 'equal' | 'add' | 'del'
  line: string
  aIndex: number
  bIndex: number
}

/** Walk the LCS matrix into an ordered edit script with line indices. */
function diffOps(a: string[], b: string[]): Op[] {
  const matrix = lcsMatrix(a, b)
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', line: a[i], aIndex: i, bIndex: j })
      i++
      j++
    } else if (matrix[i + 1][j] >= matrix[i][j + 1]) {
      ops.push({ type: 'del', line: a[i], aIndex: i, bIndex: j })
      i++
    } else {
      ops.push({ type: 'add', line: b[j], aIndex: i, bIndex: j })
      j++
    }
  }
  while (i < a.length) ops.push({ type: 'del', line: a[i], aIndex: i++, bIndex: j })
  while (j < b.length) ops.push({ type: 'add', line: b[j], aIndex: i, bIndex: j++ })
  return ops
}

/**
 * Produce a unified diff between two text blobs. Returns an empty string when
 * the inputs are identical. `context` controls lines of surrounding context.
 */
export function unifiedDiff(
  oldText: string,
  newText: string,
  oldPath = 'a',
  newPath = 'b',
  context = 3
): string {
  if (oldText === newText) return ''
  const a = splitLines(oldText)
  const b = splitLines(newText)
  const ops = diffOps(a, b)

  // Indices of changed ops, used to decide which equal lines are kept as context.
  const changeIdx = ops.map((op, idx) => (op.type === 'equal' ? -1 : idx)).filter((v) => v >= 0)
  if (changeIdx.length === 0) return ''

  // An equal op is included when it is within `context` of any change.
  const keep = new Array<boolean>(ops.length).fill(false)
  for (const c of changeIdx) {
    for (let k = Math.max(0, c - context); k <= Math.min(ops.length - 1, c + context); k++) {
      keep[k] = true
    }
  }

  // Collect contiguous runs of kept ops into hunks.
  const out: string[] = [`--- ${oldPath}`, `+++ ${newPath}`]
  let idx = 0
  while (idx < ops.length) {
    if (!keep[idx]) {
      idx++
      continue
    }
    let end = idx
    while (end < ops.length && keep[end]) end++
    const hunkOps = ops.slice(idx, end)
    out.push(renderHunk(hunkOps))
    idx = end
  }
  return out.join('\n') + '\n'
}

/** Render one contiguous run of ops into a unified-diff hunk. */
function renderHunk(hunkOps: Op[]): string {
  let aStart = -1
  let bStart = -1
  let aLen = 0
  let bLen = 0
  const lines: string[] = []
  for (const op of hunkOps) {
    if (aStart === -1) aStart = op.aIndex
    if (bStart === -1) bStart = op.bIndex
    if (op.type === 'equal') {
      lines.push(` ${op.line}`)
      aLen++
      bLen++
    } else if (op.type === 'del') {
      lines.push(`-${op.line}`)
      aLen++
    } else {
      lines.push(`+${op.line}`)
      bLen++
    }
  }
  const aHeader = aLen === 0 ? `${aStart},0` : `${aStart + 1},${aLen}`
  const bHeader = bLen === 0 ? `${bStart},0` : `${bStart + 1},${bLen}`
  return [`@@ -${aHeader} +${bHeader} @@`, ...lines].join('\n')
}
