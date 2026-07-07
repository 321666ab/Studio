import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import {
  EXTRACTED_SUFFIX,
  extractContextDocuments,
  extractDocumentText,
  isExtractableDocument
} from '../src/main/docExtract.js'

const execFileAsync = promisify(execFile)
const MARKER = '文档提取标记 DOC-EXTRACT-MARKER'

let base: string
let docxFixture: string
let pdfFixture: string | null = null

const onMac = process.platform === 'darwin'

beforeAll(async () => {
  if (!onMac) return
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-docextract-'))
  const txt = path.join(base, 'source.txt')
  await fs.writeFile(txt, `${MARKER}\nsecond line`)
  docxFixture = path.join(base, 'fixture.docx')
  await execFileAsync('textutil', ['-convert', 'docx', '-output', docxFixture, txt])
  try {
    await execFileAsync('sh', ['-c', `cupsfilter '${txt}' > '${path.join(base, 'fixture.pdf')}' 2>/dev/null`])
    const stat = await fs.stat(path.join(base, 'fixture.pdf'))
    if (stat.size > 0) pdfFixture = path.join(base, 'fixture.pdf')
  } catch {
    pdfFixture = null // cupsfilter unavailable — PDF assertions are skipped
  }
}, 30_000)

afterAll(async () => {
  if (base) await fs.rm(base, { recursive: true, force: true })
})

describe('isExtractableDocument', () => {
  it('accepts pdf and word-family extensions case-insensitively', () => {
    for (const name of ['a.pdf', 'b.PDF', 'c.docx', 'd.DOC', 'e.rtf', 'f.odt']) {
      expect(isExtractableDocument(name)).toBe(true)
    }
  })

  it('rejects text and unsupported binary formats', () => {
    for (const name of ['a.md', 'b.txt', 'c.xlsx', 'd.png', 'e']) {
      expect(isExtractableDocument(name)).toBe(false)
    }
  })
})

describe.skipIf(!onMac)('extractDocumentText', () => {
  it('extracts docx to text containing the source content', async () => {
    const dest = path.join(base, 'out-docx.txt')
    expect(await extractDocumentText(docxFixture, dest)).toBe(true)
    expect(await fs.readFile(dest, 'utf-8')).toContain(MARKER)
  })

  it('extracts pdf text via PDFKit', async () => {
    if (!pdfFixture) return // no cupsfilter on this machine
    const dest = path.join(base, 'out-pdf.txt')
    expect(await extractDocumentText(pdfFixture, dest)).toBe(true)
    expect(await fs.readFile(dest, 'utf-8')).toContain('DOC-EXTRACT-MARKER')
  })

  it('returns false for unsupported extensions and missing sources', async () => {
    const dest = path.join(base, 'out-bad.txt')
    expect(await extractDocumentText(path.join(base, 'source.txt'), dest)).toBe(false)
    expect(await extractDocumentText(path.join(base, 'missing.pdf'), dest)).toBe(false)
    await expect(fs.stat(dest)).rejects.toThrow()
  })
})

describe.skipIf(!onMac)('extractContextDocuments', () => {
  it('extracts files directly and inside context directories, skipping the rest', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-docextract-ws-'))
    try {
      await fs.mkdir(path.join(workspace, 'docs', '.hiddendir'), { recursive: true })
      await fs.mkdir(path.join(workspace, 'other'), { recursive: true })
      await fs.copyFile(docxFixture, path.join(workspace, 'top.docx'))
      await fs.copyFile(docxFixture, path.join(workspace, 'docs', 'inner.docx'))
      await fs.copyFile(docxFixture, path.join(workspace, 'docs', '.hiddendir', 'skip.docx'))
      await fs.copyFile(docxFixture, path.join(workspace, 'other', 'unlisted.docx'))
      await fs.writeFile(path.join(workspace, 'docs', 'note.md'), 'plain text')

      const results = await extractContextDocuments(workspace, [
        'top.docx',
        'docs',
        'missing-path.docx'
      ])
      const pairs = results.map((item) => [item.source, item.extracted]).sort()
      expect(pairs).toEqual([
        ['docs/inner.docx', `docs/inner.docx${EXTRACTED_SUFFIX}`],
        ['top.docx', `top.docx${EXTRACTED_SUFFIX}`]
      ])
      for (const item of results) {
        const text = await fs.readFile(path.join(workspace, item.extracted), 'utf-8')
        expect(text).toContain(MARKER)
      }
      // Unlisted and dot-dir files must not have been extracted.
      await expect(
        fs.stat(path.join(workspace, 'other', `unlisted.docx${EXTRACTED_SUFFIX}`))
      ).rejects.toThrow()
      await expect(
        fs.stat(path.join(workspace, 'docs', '.hiddendir', `skip.docx${EXTRACTED_SUFFIX}`))
      ).rejects.toThrow()
    } finally {
      await fs.rm(workspace, { recursive: true, force: true })
    }
  })
})
