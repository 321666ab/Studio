import { createHash } from 'crypto'
import type { ChangedFile } from '../shared/types.js'
import { unifiedDiff } from './diff.js'

/** Text files larger than this keep their hash but skip content/diff capture. */
export const MAX_DIFF_BYTES = 1 * 1024 * 1024 // 1 MiB

/** A point-in-time capture of one file's identity and (optionally) its text. */
export interface FileSnapshot {
  /** SHA-256 of the raw bytes. */
  hash: string
  size: number
  binary: boolean
  /** Decoded text, present only for non-binary files within the size cap. */
  text?: string
}

/** Map of workspace-relative POSIX path -> snapshot. */
export type SnapshotMap = Map<string, FileSnapshot>

export function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

/** Heuristic binary check: a NUL byte in the first 8000 bytes. */
export function looksBinary(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, 8000)
  for (let i = 0; i < limit; i++) {
    if (buffer[i] === 0) return true
  }
  return false
}

/** Build a FileSnapshot from raw bytes, capturing text when practical. */
export function snapshotFromBuffer(buffer: Buffer): FileSnapshot {
  const binary = looksBinary(buffer)
  const snapshot: FileSnapshot = {
    hash: hashBuffer(buffer),
    size: buffer.length,
    binary
  }
  if (!binary && buffer.length <= MAX_DIFF_BYTES) {
    snapshot.text = buffer.toString('utf-8')
  }
  return snapshot
}

/**
 * Compute the set of changes between a baseline and current snapshot. Produces
 * ChangedFile metadata and, where both sides are captured text, a unified diff.
 * Pure: operates only on the supplied maps.
 */
export function computeChanges(baseline: SnapshotMap, current: SnapshotMap): ChangedFile[] {
  const changes: ChangedFile[] = []
  const paths = new Set<string>([...baseline.keys(), ...current.keys()])

  for (const path of [...paths].sort()) {
    const before = baseline.get(path)
    const after = current.get(path)

    if (before && !after) {
      changes.push({
        path,
        changeType: 'deleted',
        baselineHash: before.hash,
        currentHash: null,
        size: 0,
        binary: before.binary,
        diff: before.text !== undefined ? safeUnifiedDiff(before.text, '', path, '/dev/null') : undefined
      })
      continue
    }
    if (!before && after) {
      changes.push({
        path,
        changeType: 'added',
        baselineHash: null,
        currentHash: after.hash,
        size: after.size,
        binary: after.binary,
        diff: after.text !== undefined ? safeUnifiedDiff('', after.text, '/dev/null', path) : undefined
      })
      continue
    }
    if (before && after && before.hash !== after.hash) {
      changes.push({
        path,
        changeType: 'modified',
        baselineHash: before.hash,
        currentHash: after.hash,
        size: after.size,
        binary: before.binary || after.binary,
        diff:
          before.text !== undefined && after.text !== undefined
            ? safeUnifiedDiff(before.text, after.text, path, path)
            : undefined
      })
    }
  }
  return changes
}

const MAX_DIFF_MATRIX_CELLS = 4_000_000

function safeUnifiedDiff(
  before: string,
  after: string,
  beforePath: string,
  afterPath: string
): string | undefined {
  const beforeLines = before === '' ? 0 : before.split('\n').length
  const afterLines = after === '' ? 0 : after.split('\n').length
  if (beforeLines * afterLines > MAX_DIFF_MATRIX_CELLS) return undefined
  return unifiedDiff(before, after, beforePath, afterPath)
}

/** Why a single file could not be applied back to the source. */
export type ConflictReason = 'baseline-changed' | 'missing' | 'error'

export interface ConflictDecision {
  apply: boolean
  reason?: ConflictReason
}

/**
 * Decide whether a changed file is safe to apply to the source. The guard: the
 * source file's current hash must still match the baseline the agent started
 * from. If the source moved underneath us, applying would clobber a concurrent
 * edit, so we flag a conflict instead.
 *
 * @param baselineHash hash the agent observed at task start (null = file absent)
 * @param sourceHash   hash of the source file right now (null = file absent)
 */
export function decideApply(
  baselineHash: string | null,
  sourceHash: string | null
): ConflictDecision {
  // For additions the agent expected no file; if one now exists with different
  // content, that is a conflict.
  if (baselineHash === null) {
    if (sourceHash === null) return { apply: true }
    return { apply: false, reason: 'baseline-changed' }
  }
  // For modifications/deletions the source must still match the baseline.
  if (sourceHash === null) return { apply: false, reason: 'missing' }
  if (sourceHash !== baselineHash) return { apply: false, reason: 'baseline-changed' }
  return { apply: true }
}
