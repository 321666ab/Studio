/**
 * Extract a heading outline from Markdown source for the TOC sidebar.
 * Handles ATX (`# 标题`) and setext (`标题` + `===`/`---`) headings and skips
 * anything inside fenced code blocks, mirroring what marked renders so the
 * Nth outline item corresponds to the Nth h1–h6 in the preview DOM.
 */

export interface OutlineItem {
  /** Heading level, 1–6. */
  level: number
  /** Plain text with inline Markdown markers stripped. */
  text: string
  /** 0-based source line of the heading text. */
  line: number
  /** Ordinal among all headings in the document. */
  index: number
}

const ATX_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/
const SETEXT_UNDERLINE_RE = /^ {0,3}(=+|-{2,})[ \t]*$/
/** Lines that can never be a setext heading's text line. */
const NON_PARAGRAPH_RE = /^ {0,3}(#{1,6}[ \t]|[-*+][ \t]|\d+[.)][ \t]|>|`{3,}|~{3,}|\||$)/

/** Strip common inline Markdown syntax down to readable text. */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images → alt
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → label
    .replace(/`([^`]*)`/g, '$1') // code spans
    .replace(/(\*\*|__)(.*?)\1/g, '$2') // strong
    .replace(/(\*|_)(.*?)\1/g, '$2') // emphasis
    .replace(/~~(.*?)~~/g, '$1') // strikethrough
    .replace(/<[^>]+>/g, '') // raw html tags
    .trim()
}

export function extractOutline(source: string): OutlineItem[] {
  const lines = source.split(/\r\n|\r|\n/)
  const items: OutlineItem[] = []
  let fence: string | null = null

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]

    const fenceMatch = line.match(FENCE_RE)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!fence) {
        fence = marker
      } else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null
      }
      continue
    }
    if (fence) continue

    const atx = line.match(ATX_RE)
    if (atx) {
      const text = stripInlineMarkdown(atx[2] ?? '')
      if (text) {
        items.push({ level: atx[1].length, text, line: i, index: items.length })
      }
      continue
    }

    // Setext: a plain paragraph line followed by === (h1) or --- (h2).
    const next = lines[i + 1]
    if (
      next !== undefined &&
      SETEXT_UNDERLINE_RE.test(next) &&
      line.trim() !== '' &&
      !NON_PARAGRAPH_RE.test(line)
    ) {
      const text = stripInlineMarkdown(line)
      if (text) {
        items.push({
          level: next.trimStart().startsWith('=') ? 1 : 2,
          text,
          line: i,
          index: items.length
        })
      }
      i += 1 // consume the underline
    }
  }

  return items
}
