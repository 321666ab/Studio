import { describe, expect, it } from 'vitest'
import { extractOutline, stripInlineMarkdown } from '../src/renderer/lib/outline.js'

describe('extractOutline', () => {
  it('extracts ATX headings with level, text, and line', () => {
    const items = extractOutline('# Title\n\ntext\n\n## Section\n\n### Sub')
    expect(items).toEqual([
      { level: 1, text: 'Title', line: 0, index: 0 },
      { level: 2, text: 'Section', line: 4, index: 1 },
      { level: 3, text: 'Sub', line: 6, index: 2 }
    ])
  })

  it('strips trailing closing hashes', () => {
    const items = extractOutline('## Section ##')
    expect(items[0].text).toBe('Section')
  })

  it('ignores headings inside fenced code blocks', () => {
    const source = '# Real\n\n```md\n# Fake\n```\n\n~~~\n## Also fake\n~~~\n\n## Real too'
    const items = extractOutline(source)
    expect(items.map((item) => item.text)).toEqual(['Real', 'Real too'])
  })

  it('handles unbalanced fences by swallowing the rest', () => {
    const items = extractOutline('# Real\n```\n# Fake forever')
    expect(items.map((item) => item.text)).toEqual(['Real'])
  })

  it('extracts setext headings', () => {
    const items = extractOutline('Big Title\n=========\n\nSmaller\n---\n\nbody')
    expect(items).toEqual([
      { level: 1, text: 'Big Title', line: 0, index: 0 },
      { level: 2, text: 'Smaller', line: 3, index: 1 }
    ])
  })

  it('does not treat a horizontal rule or list underline as setext', () => {
    // `---` after a blank line is an hr, not a heading underline.
    expect(extractOutline('para\n\n---\n')).toEqual([])
    // `- item` followed by --- must not turn the list item into a heading.
    expect(extractOutline('- item\n---\n')).toEqual([])
  })

  it('skips empty headings and requires a space after #', () => {
    expect(extractOutline('#\n##   \n#tag')).toEqual([])
  })

  it('strips inline markdown from heading text', () => {
    const items = extractOutline('# The **bold** `code` [link](https://x) ![img](y)')
    expect(items[0].text).toBe('The bold code link img')
  })

  it('numbers headings sequentially across the document', () => {
    const items = extractOutline('# A\n## B\nSetext\n---\n### C')
    expect(items.map((item) => item.index)).toEqual([0, 1, 2, 3])
  })
})

describe('stripInlineMarkdown', () => {
  it('removes raw html tags', () => {
    expect(stripInlineMarkdown('Hello <em>world</em>')).toBe('Hello world')
  })
})
