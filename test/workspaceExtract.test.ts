import { afterAll, describe, expect, it } from 'vitest'
import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { prepareWorkspace } from '../src/main/workspace.js'

const execFileAsync = promisify(execFile)
const cleanups: Array<() => Promise<void>> = []

afterAll(async () => {
  for (const cleanup of cleanups) await cleanup().catch(() => undefined)
})

describe.skipIf(process.platform !== 'darwin')('prepareWorkspace context document extraction', () => {
  it('extracts context docx/pdf into the workspace before the baseline', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-e2e-'))
    cleanups.push(async () => fs.rm(base, { recursive: true, force: true }))
    const proj = path.join(base, 'proj')
    await fs.mkdir(path.join(proj, 'docs'), { recursive: true })
    const txt = path.join(base, 't.txt')
    await fs.writeFile(txt, '端到端提取验证 marker EXTRACT-OK')
    await execFileAsync('textutil', [
      '-convert', 'docx', '-output', path.join(proj, 'docs', 'report.docx'), txt
    ])
    await fs.writeFile(path.join(proj, 'readme.md'), 'hello')

    const ws = await prepareWorkspace(proj, ['docs/report.docx'])
    cleanups.push(ws.cleanup)

    expect(ws.extractedDocs).toEqual([
      { source: 'docs/report.docx', extracted: 'docs/report.docx.extracted.txt' }
    ])
    const text = await fs.readFile(
      path.join(ws.path, 'docs/report.docx.extracted.txt'),
      'utf-8'
    )
    expect(text).toContain('EXTRACT-OK')
    // Extracted file is part of the baseline, so it never shows up as an
    // agent-made change in the apply-back diff.
    expect(ws.baseline.has('docs/report.docx.extracted.txt')).toBe(true)
  })
})
