import { promises as fs } from 'fs'
import path from 'path'
import type { AgentContextEstimate, AgentContextItem } from '../shared/types.js'
import { isExcludedDir, toPosix } from './workspace.js'
import { resolveWithinRoot } from './security.js'

export const DEFAULT_CONTEXT_TOKEN_BUDGET = 24_000
export const MAX_CONTEXT_FILE_BYTES = 64 * 1024

export async function estimateContext(
  root: string,
  requestedPaths: string[]
): Promise<AgentContextEstimate> {
  if (!Array.isArray(requestedPaths) || requestedPaths.length > 200) {
    throw new Error('上下文路径数量无效')
  }
  const unique = [...new Set(requestedPaths)]
  const realRoot = await fs.realpath(root)
  const items: AgentContextItem[] = []
  let totalBytes = 0
  let estimatedTokens = 0
  let fileCount = 0

  for (const requested of unique) {
    const safe = await resolveWithinRoot(realRoot, requested)
    const stat = await fs.stat(safe)
    const directory = stat.isDirectory() ? await estimateDirectory(realRoot, safe) : null
    const summary = directory?.item ?? (await estimateFile(realRoot, safe))
    items.push(summary)
    totalBytes += summary.size
    estimatedTokens += summary.estimatedTokens
    fileCount += directory?.fileCount ?? 1
  }

  return { items, totalBytes, estimatedTokens, fileCount }
}

async function estimateDirectory(
  root: string,
  dir: string
): Promise<{ item: AgentContextItem; fileCount: number }> {
  let size = 0
  let estimatedTokens = 0
  let fileCount = 0
  let truncated = false
  let binary = false
  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === '.git' || (entry.isDirectory() && isExcludedDir(entry.name))) continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile()) {
        const item = await estimateFile(root, full)
        fileCount += 1
        size += item.size
        estimatedTokens += item.estimatedTokens
        truncated ||= item.truncated
        binary ||= item.binary
      }
    }
  }
  await walk(dir)
  return {
    item: {
      path: dir,
      relativePath: toPosix(path.relative(root, dir)) || '.',
      isDirectory: true,
      size,
      estimatedTokens,
      truncated,
      binary
    },
    fileCount
  }
}

async function estimateFile(root: string, file: string): Promise<AgentContextItem> {
  const stat = await fs.stat(file)
  const length = Math.min(stat.size, MAX_CONTEXT_FILE_BYTES)
  const handle = await fs.open(file, 'r')
  const buffer = Buffer.alloc(length)
  try {
    if (length) await handle.read(buffer, 0, length, 0)
  } finally {
    await handle.close()
  }
  const binary = looksBinary(buffer)
  const estimatedTokens = binary ? 32 : Math.max(1, Math.ceil(length / 4))
  return {
    path: file,
    relativePath: toPosix(path.relative(root, file)),
    isDirectory: false,
    size: stat.size,
    estimatedTokens,
    truncated: stat.size > MAX_CONTEXT_FILE_BYTES,
    binary
  }
}

function looksBinary(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, 8000)
  for (let index = 0; index < limit; index += 1) {
    if (buffer[index] === 0) return true
  }
  return false
}
