import { promises as fs } from 'fs'
import path from 'path'
import type {
  DirEntry,
  FileInfo,
  ProjectFileEntry,
  ReadFileResult,
  WriteFileResult
} from '../shared/types.js'
import { isIgnoredEntry, resolveWithinRoot } from './security.js'

/** Files larger than this are read only partially (truncated) to stay responsive. */
export const MAX_READ_BYTES = 2 * 1024 * 1024 // 2 MiB
export const MAX_WRITE_BYTES = 5 * 1024 * 1024 // 5 MiB
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])

/**
 * List a directory's immediate children, filtering hidden / cache / vcs entries.
 * The directory is validated to live inside `root` before any read.
 */
export async function readDir(root: string, dirPath: string): Promise<DirEntry[]> {
  const safeDir = await resolveWithinRoot(root, dirPath)
  const dirents = await fs.readdir(safeDir, { withFileTypes: true })

  const entries: DirEntry[] = []
  for (const dirent of dirents) {
    if (isIgnoredEntry(dirent.name)) continue
    const fullPath = path.join(safeDir, dirent.name)
    entries.push({
      name: dirent.name,
      path: fullPath,
      isDirectory: dirent.isDirectory(),
      isSymbolicLink: dirent.isSymbolicLink()
    })
  }

  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return entries
}

/** Caps that keep the quick-open listing responsive on huge projects. */
export const MAX_PROJECT_FILES = 20000
const MAX_WALK_DEPTH = 16

/**
 * Recursively list every non-ignored file under the project root for the
 * quick-open palette. Symlinked directories are not followed (avoids cycles
 * and root escapes); the walk stops early at MAX_PROJECT_FILES entries.
 */
export async function listProjectFiles(root: string): Promise<ProjectFileEntry[]> {
  const realRoot = await fs.realpath(root)
  const results: ProjectFileEntry[] = []
  const queue: Array<{ dir: string; depth: number }> = [{ dir: realRoot, depth: 0 }]

  for (let head = 0; head < queue.length; head += 1) {
    const { dir, depth } = queue[head]
    let dirents
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue // unreadable directory — skip silently, like the tree does
    }
    for (const dirent of dirents) {
      if (isIgnoredEntry(dirent.name)) continue
      const fullPath = path.join(dir, dirent.name)
      if (dirent.isDirectory()) {
        if (depth < MAX_WALK_DEPTH) queue.push({ dir: fullPath, depth: depth + 1 })
      } else if (dirent.isFile()) {
        results.push({
          name: dirent.name,
          path: fullPath,
          relativePath: path.relative(realRoot, fullPath)
        })
        if (results.length >= MAX_PROJECT_FILES) {
          return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
        }
      }
    }
  }

  return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

export async function getFileInfo(root: string, filePath: string): Promise<FileInfo> {
  const safePath = await resolveWithinRoot(root, filePath)
  const stat = await fs.lstat(safePath)
  return {
    path: safePath,
    size: stat.size,
    isDirectory: stat.isDirectory(),
    isSymbolicLink: stat.isSymbolicLink(),
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs
  }
}

/**
 * Read a file as text. Tries UTF-8 first; if the bytes contain invalid UTF-8
 * sequences, falls back to GB18030. Large files are truncated to MAX_READ_BYTES.
 */
export async function readFileText(root: string, filePath: string): Promise<ReadFileResult> {
  const safePath = await resolveWithinRoot(root, filePath)
  const stat = await fs.stat(safePath)

  const truncated = stat.size > MAX_READ_BYTES
  const handle = await fs.open(safePath, 'r')
  let buffer: Buffer
  try {
    const length = truncated ? MAX_READ_BYTES : stat.size
    buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, 0)
  } finally {
    await handle.close()
  }

  const { content, encoding } = decodeText(buffer)
  return { content, encoding, truncated, size: stat.size }
}

export async function writeMarkdown(
  root: string,
  filePath: string,
  content: string
): Promise<WriteFileResult> {
  if (typeof content !== 'string') throw new Error('文档内容无效')
  const size = Buffer.byteLength(content, 'utf-8')
  if (size > MAX_WRITE_BYTES) throw new Error('Markdown 文件超过 5 MB，无法保存')

  const safePath = await resolveWithinRoot(root, filePath)
  if (!MARKDOWN_EXTENSIONS.has(path.extname(safePath).toLowerCase())) {
    throw new Error('仅允许保存 Markdown 文件')
  }

  const stat = await fs.stat(safePath)
  if (!stat.isFile()) throw new Error('目标不是文件')

  await fs.writeFile(safePath, content, { encoding: 'utf-8', flag: 'w' })
  const updated = await fs.stat(safePath)
  return { size: updated.size, mtimeMs: updated.mtimeMs }
}

/**
 * Decode a buffer to text, preferring UTF-8 and falling back to GB18030 when the
 * bytes are not valid UTF-8. Uses the platform TextDecoder with fatal mode to
 * detect invalid UTF-8 reliably.
 */
export function decodeText(buffer: Buffer): { content: string; encoding: 'utf-8' | 'gb18030' } {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    return { content: decoder.decode(buffer), encoding: 'utf-8' }
  } catch {
    // Not valid UTF-8 — fall back to GB18030 (covers GBK/GB2312 as subsets).
    const decoder = new TextDecoder('gb18030')
    return { content: decoder.decode(buffer), encoding: 'gb18030' }
  }
}
