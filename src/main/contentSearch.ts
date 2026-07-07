import { promises as fs } from 'fs'
import type { ContentSearchMatch, ContentSearchResult } from '../shared/types.js'
import { decodeText, listProjectFiles } from './fileService.js'

/** Files larger than this are skipped entirely — content search stays snappy. */
export const MAX_SEARCH_FILE_BYTES = 1.5 * 1024 * 1024
/** Global cap across all files; the result is marked truncated when hit. */
export const MAX_TOTAL_MATCHES = 300
/** Per-file cap so one log-like file cannot crowd out the rest. */
export const MAX_MATCHES_PER_FILE = 10
/** Matched lines are clipped to this many characters around the hit. */
const MAX_LINE_DISPLAY = 200
/** How many files are read concurrently during a search. */
const CONCURRENCY = 8
/** A NUL byte in the head of a file marks it as binary. */
const BINARY_SNIFF_BYTES = 8192

/**
 * Pure matcher: find case-insensitive occurrences of `query` in `content`,
 * one match per line (first hit wins), each clipped to a display window
 * around the hit. Line numbers are 1-based.
 */
export function findLineMatches(
  content: string,
  query: string,
  limit = MAX_MATCHES_PER_FILE
): Array<Omit<ContentSearchMatch, 'path' | 'relativePath'>> {
  const needle = query.toLowerCase()
  if (!needle) return []
  const matches: Array<Omit<ContentSearchMatch, 'path' | 'relativePath'>> = []
  const lines = content.split(/\r\n|\r|\n/)
  for (let i = 0; i < lines.length && matches.length < limit; i += 1) {
    const line = lines[i]
    const hit = line.toLowerCase().indexOf(needle)
    if (hit === -1) continue
    matches.push(clipLine(line, i + 1, hit, needle.length))
  }
  return matches
}

/** Clip a long line to a window around the hit, keeping highlight offsets valid. */
function clipLine(
  line: string,
  lineNumber: number,
  hit: number,
  matchLength: number
): Omit<ContentSearchMatch, 'path' | 'relativePath'> {
  let text = line
  let start = hit
  if (line.length > MAX_LINE_DISPLAY) {
    // Center the window on the hit; ellipses are added by the renderer.
    const windowStart = Math.max(0, Math.min(hit - 40, line.length - MAX_LINE_DISPLAY))
    text = line.slice(windowStart, windowStart + MAX_LINE_DISPLAY)
    start = hit - windowStart
  }
  return {
    line: lineNumber,
    lineText: text,
    matchStart: start,
    matchEnd: Math.min(start + matchLength, text.length)
  }
}

/**
 * Search every non-ignored text file under the project root for `query`
 * (case-insensitive literal). Oversized and binary files are skipped; the
 * scan reuses the quick-open walk so ignore rules stay in one place.
 */
export async function searchProjectContent(
  root: string,
  query: string
): Promise<ContentSearchResult> {
  const trimmed = query.trim()
  if (!trimmed) return { matches: [], filesScanned: 0, truncated: false }

  const files = await listProjectFiles(root)
  const matches: ContentSearchMatch[] = []
  let filesScanned = 0
  let truncated = false
  let next = 0

  const worker = async (): Promise<void> => {
    while (next < files.length && matches.length < MAX_TOTAL_MATCHES) {
      const file = files[next]
      next += 1
      let buffer: Buffer
      try {
        const stat = await fs.stat(file.path)
        if (stat.size > MAX_SEARCH_FILE_BYTES) continue
        buffer = await fs.readFile(file.path)
      } catch {
        continue // unreadable file — skip, like the tree does
      }
      if (buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0)) continue
      filesScanned += 1
      const { content } = decodeText(buffer)
      for (const match of findLineMatches(content, trimmed)) {
        if (matches.length >= MAX_TOTAL_MATCHES) {
          truncated = true
          break
        }
        matches.push({ ...match, path: file.path, relativePath: file.relativePath })
      }
    }
    if (next < files.length && matches.length >= MAX_TOTAL_MATCHES) truncated = true
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  matches.sort(
    (a, b) => a.relativePath.localeCompare(b.relativePath) || a.line - b.line
  )
  return { matches, filesScanned, truncated }
}
