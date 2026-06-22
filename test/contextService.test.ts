import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  estimateContext,
  MAX_CONTEXT_FILE_BYTES
} from '../src/main/contextService.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('estimateContext', () => {
  it('estimates text, binary and truncated files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-context-'))
    tempDirs.push(root)
    const text = path.join(root, 'notes.md')
    const binary = path.join(root, 'image.bin')
    const large = path.join(root, 'large.txt')
    await fs.writeFile(text, 'hello world')
    await fs.writeFile(binary, Buffer.from([1, 0, 2]))
    await fs.writeFile(large, Buffer.alloc(MAX_CONTEXT_FILE_BYTES + 10, 65))

    const estimate = await estimateContext(root, [text, binary, large])
    expect(estimate.fileCount).toBe(3)
    expect(estimate.items.find((item) => item.relativePath === 'image.bin')?.binary).toBe(true)
    expect(estimate.items.find((item) => item.relativePath === 'large.txt')?.truncated).toBe(true)
    expect(estimate.estimatedTokens).toBeGreaterThan(0)
  })

  it('expands directories while excluding generated folders', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-context-dir-'))
    tempDirs.push(root)
    const docs = path.join(root, 'docs')
    await fs.mkdir(path.join(docs, 'node_modules'), { recursive: true })
    await fs.writeFile(path.join(docs, 'one.md'), 'one')
    await fs.writeFile(path.join(docs, 'node_modules', 'ignored.js'), 'ignored')

    const estimate = await estimateContext(root, [docs])
    expect(estimate.fileCount).toBe(1)
    expect(estimate.items[0].relativePath).toBe('docs')
  })

  it('rejects paths outside the project root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-context-root-'))
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-context-outside-'))
    tempDirs.push(root, outside)
    const file = path.join(outside, 'secret.txt')
    await fs.writeFile(file, 'secret')
    await expect(estimateContext(root, [file])).rejects.toThrow(/escapes project root/)
  })
})
