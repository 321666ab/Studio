import { marked } from 'marked'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

/**
 * Render Markdown to a sanitized HTML string.
 *
 * marked itself does not sanitize, and we never trust its output: the parsed
 * HTML is re-parsed with DOMParser and walked, dropping any dangerous element
 * (script/style/iframe/etc.), any event-handler attribute (on*), and any URL
 * attribute whose scheme is not an explicit allowlist. Only the surviving,
 * cleaned tree is serialized back to a string.
 */

const ALLOWED_TAGS = new Set([
  'A', 'P', 'BR', 'HR', 'EM', 'STRONG', 'DEL', 'CODE', 'PRE', 'BLOCKQUOTE',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'UL', 'OL', 'LI', 'IMG',
  'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD',
  'SPAN', 'DIV'
])

// Per-tag attribute allowlist. Anything not listed is removed.
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  A: new Set(['href', 'title']),
  IMG: new Set(['src', 'alt', 'title']),
  TD: new Set(['align']),
  TH: new Set(['align'])
}

const SAFE_URL = /^(https?:|mailto:|app-preview:|#)/i

function isSafeUrl(value: string): boolean {
  const trimmed = value.trim()
  // Reject anything with a scheme that isn't allowlisted (e.g. javascript:, data:).
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return SAFE_URL.test(trimmed)
  return true // relative / fragment URLs are fine
}

function sanitizeElement(el: Element): void {
  // Snapshot children first; we may remove some during iteration.
  for (const child of Array.from(el.children)) {
    sanitizeElement(child)
  }

  if (!ALLOWED_TAGS.has(el.tagName)) {
    // Unwrap unknown-but-harmless containers, drop the rest entirely.
    el.replaceWith(...Array.from(el.childNodes))
    return
  }

  const allowed = ALLOWED_ATTRS[el.tagName]
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase()
    const keep = allowed?.has(name) ?? false
    if (!keep) {
      el.removeAttribute(attr.name)
      continue
    }
    if ((name === 'href' || name === 'src') && !isSafeUrl(attr.value)) {
      el.removeAttribute(attr.name)
    }
  }

  if (el.tagName === 'A') {
    el.setAttribute('rel', 'noopener noreferrer')
  }
}

export function renderMarkdown(source: string): string {
  const rawHtml = marked.parse(source, { async: false, gfm: true, breaks: false }) as string
  const doc = new DOMParser().parseFromString(rawHtml, 'text/html')

  // Hard-remove obviously dangerous nodes before the recursive pass.
  doc.body
    .querySelectorAll('script, style, iframe, object, embed, link, meta, form, input, button')
    .forEach((n) => n.remove())

  for (const child of Array.from(doc.body.children)) {
    sanitizeElement(child)
  }
  return doc.body.innerHTML
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '_',
  strongDelimiter: '**'
})

turndown.use(gfm)
turndown.remove(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'])

/** Convert the trusted editable-preview DOM back into normalized Markdown. */
export function htmlToMarkdown(html: string): string {
  const markdown = turndown
    .turndown(html)
    .replace(/\u00a0/g, ' ')
    .replace(/^(\s*)-\s{2,}/gm, '$1- ')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
  return markdown ? `${markdown}\n` : ''
}
