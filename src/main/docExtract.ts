import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import { promisify } from 'util'
import { toPosix } from './workspace.js'

const execFileAsync = promisify(execFile)

/**
 * Binary documents attached as AI context are extracted to plain-text siblings
 * inside the isolated workspace, because CLI agents can only send text to
 * OpenAI-compatible third-party endpoints (e.g. 火山引擎 ARK rejects Anthropic
 * `document` content blocks with a 400). Extraction uses only tools bundled
 * with macOS: PDFKit via JXA for PDF, textutil for Word/RTF/ODT.
 */

/** Suffix appended to the original filename for the extracted text version. */
export const EXTRACTED_SUFFIX = '.extracted.txt'
/** At most this many documents are extracted per task. */
export const MAX_EXTRACTED_DOCS = 20
/** Extracted text larger than this is truncated. */
export const MAX_EXTRACTED_BYTES = 4 * 1024 * 1024
/** A single extraction may take at most this long. */
const EXTRACT_TIMEOUT_MS = 30_000

const TEXTUTIL_EXTENSIONS = new Set(['.doc', '.docx', '.rtf', '.rtfd', '.odt'])

/** One successful extraction, in workspace-relative POSIX paths. */
export interface ExtractedDoc {
  source: string
  extracted: string
}

export function isExtractableDocument(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return ext === '.pdf' || TEXTUTIL_EXTENSIONS.has(ext)
}

/** JXA program: read a PDF with PDFKit and write its text to a UTF-8 file. */
const PDF_EXTRACT_JXA = [
  'function run(argv) {',
  "  ObjC.import('Quartz')",
  '  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]))',
  "  if (doc.isNil()) return 'NIL_DOC'",
  '  const text = doc.string',
  "  if (text.isNil()) return 'NIL_TEXT'",
  '  const ok = text.writeToFileAtomicallyEncodingError(argv[1], true, $.NSUTF8StringEncoding, null)',
  "  return ok ? 'OK' : 'WRITE_FAIL'",
  '}'
].join('\n')

/** Extract one document to `destination`; false when extraction is impossible. */
export async function extractDocumentText(
  sourcePath: string,
  destinationPath: string
): Promise<boolean> {
  if (process.platform !== 'darwin') return false
  const ext = path.extname(sourcePath).toLowerCase()
  try {
    if (ext === '.pdf') {
      const { stdout } = await execFileAsync(
        'osascript',
        ['-l', 'JavaScript', '-e', PDF_EXTRACT_JXA, sourcePath, destinationPath],
        { timeout: EXTRACT_TIMEOUT_MS }
      )
      if (stdout.trim() !== 'OK') return false
    } else if (TEXTUTIL_EXTENSIONS.has(ext)) {
      await execFileAsync(
        'textutil',
        ['-convert', 'txt', '-output', destinationPath, sourcePath],
        { timeout: EXTRACT_TIMEOUT_MS }
      )
    } else {
      return false
    }
    const stat = await fs.stat(destinationPath)
    if (stat.size === 0) {
      await fs.rm(destinationPath, { force: true })
      return false
    }
    if (stat.size > MAX_EXTRACTED_BYTES) {
      await fs.truncate(destinationPath, MAX_EXTRACTED_BYTES)
    }
    return true
  } catch {
    await fs.rm(destinationPath, { force: true }).catch(() => undefined)
    return false
  }
}

/**
 * Extract every extractable document reachable from the given context paths
 * (files directly, directories recursively) inside the prepared workspace.
 * Failures are silent: the original file simply stays binary-only.
 */
export async function extractContextDocuments(
  workspaceRoot: string,
  contextRelativePaths: string[]
): Promise<ExtractedDoc[]> {
  if (process.platform !== 'darwin') return []
  const candidates: string[] = []
  const seen = new Set<string>()

  const addFile = (absolute: string): void => {
    if (seen.has(absolute) || !isExtractableDocument(absolute)) return
    seen.add(absolute)
    candidates.push(absolute)
  }

  const walk = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile()) addFile(full)
    }
  }

  for (const relative of contextRelativePaths) {
    const absolute = path.join(workspaceRoot, relative)
    let stat
    try {
      stat = await fs.stat(absolute)
    } catch {
      continue
    }
    if (stat.isDirectory()) await walk(absolute)
    else if (stat.isFile()) addFile(absolute)
  }

  const results: ExtractedDoc[] = []
  for (const source of candidates.slice(0, MAX_EXTRACTED_DOCS)) {
    const destination = source + EXTRACTED_SUFFIX
    if (await extractDocumentText(source, destination)) {
      results.push({
        source: toPosix(path.relative(workspaceRoot, source)),
        extracted: toPosix(path.relative(workspaceRoot, destination))
      })
    }
  }
  return results
}
