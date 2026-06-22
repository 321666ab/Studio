// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { htmlToMarkdown, renderMarkdown } from '../src/renderer/lib/markdown.js'

describe('renderMarkdown', () => {
  it('renders ordinary Markdown while removing executable HTML', () => {
    const html = renderMarkdown(
      '# 标题\n\n<script>alert(1)</script><img src="x" onerror="alert(2)">'
    )
    expect(html).toContain('<h1>标题</h1>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
  })

  it('removes unsafe URL schemes', () => {
    const html = renderMarkdown('[危险链接](javascript:alert(1))')
    expect(html).not.toContain('javascript:')
  })
})

describe('htmlToMarkdown', () => {
  it('converts edited preview structure back to Markdown', () => {
    expect(
      htmlToMarkdown('<h1>标题</h1><p>正文 <strong>加粗</strong></p><ul><li>项目</li></ul>')
    ).toBe('# 标题\n\n正文 **加粗**\n\n- 项目\n')
  })

  it('keeps GFM table structure', () => {
    const markdown = htmlToMarkdown(
      '<table><thead><tr><th>名称</th><th>状态</th></tr></thead>' +
        '<tbody><tr><td>Studio</td><td>完成</td></tr></tbody></table>'
    )
    expect(markdown).toContain('| 名称 | 状态 |')
    expect(markdown).toContain('| --- | --- |')
    expect(markdown).toContain('| Studio | 完成 |')
  })
})
