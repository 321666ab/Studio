import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { promisify } from 'util'
import { snapshotFromBuffer, type SnapshotMap } from './workspaceDiff.js'

const execFileAsync = promisify(execFile)

/** Non-git sources larger than this are refused to avoid huge temp copies. */
export const MAX_NONGIT_COPY_BYTES = 500 * 1024 * 1024 // 500 MiB

/**
 * Directory names that are never copied into a temp workspace and never walked
 * when snapshotting. Mirrors the tree-ignore policy plus common build output.
 */
export const WORKSPACE_EXCLUDED_DIRS = new Set<string>([
  '.git',
  'node_modules',
  '.cache',
  '__pycache__',
  '.next',
  '.turbo',
  '.parcel-cache',
  'dist',
  'out',
  'build',
  'coverage',
  '.venv',
  'venv',
  'target',
  '.gradle',
  '.idea'
])

/** True for cache/build directories excluded from every isolated workspace. */
export function isExcludedDir(name: string): boolean {
  return WORKSPACE_EXCLUDED_DIRS.has(name)
}

function isNonGitExcludedDir(name: string): boolean {
  return name.startsWith('.') || isExcludedDir(name)
}

export interface PreparedWorkspace {
  /** Absolute path to the isolated working directory. */
  path: string
  /** True when backed by a git worktree (vs. a plain temp copy). */
  isGitWorktree: boolean
  /** The original source root this workspace mirrors. */
  sourceRoot: string
  /** Snapshot of the workspace contents at preparation time. */
  baseline: SnapshotMap
  /** Tear down the workspace (remove worktree or temp dir). */
  cleanup: () => Promise<void>
}

/** Determine whether `root` is inside a git working tree. */
export async function isGitRepo(root: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: root,
      timeout: 5000
    })
    return stdout.trim() === 'true'
  } catch {
    return false
  }
}

/** Sum the byte size of all non-excluded files under `root`. */
export async function directorySize(root: string): Promise<number> {
  let total = 0
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (isNonGitExcludedDir(entry.name)) continue
        await walk(path.join(dir, entry.name))
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(path.join(dir, entry.name))
          total += stat.size
        } catch {
          // Vanished between readdir and stat; ignore.
        }
      }
    }
  }
  await walk(root)
  return total
}

/**
 * Capture a snapshot of every non-excluded file under `root`, keyed by POSIX
 * path relative to `root`.
 */
export async function snapshotTree(root: string): Promise<SnapshotMap> {
  const map: SnapshotMap = new Map()
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (isExcludedDir(entry.name)) continue
        await walk(full)
      } else if (entry.isFile()) {
        try {
          const buffer = await fs.readFile(full)
          const rel = toPosix(path.relative(root, full))
          map.set(rel, snapshotFromBuffer(buffer))
        } catch {
          // Unreadable file; skip it.
        }
      }
    }
  }
  await walk(root)
  return map
}

export function toPosix(p: string): string {
  return p.split(path.sep).join('/')
}

/**
 * Prepare an isolated workspace for a task. Git repos get a detached worktree
 * (cheap, COW-friendly, captures tracked + untracked state via checkout). Other
 * directories are copied to a temp location, excluding dot/cache/build dirs,
 * after a size guard. The returned baseline snapshot reflects the workspace.
 */
export async function prepareWorkspace(sourceRoot: string): Promise<PreparedWorkspace> {
  const realSource = await fs.realpath(sourceRoot)
  const gitBacked = await isGitRepo(realSource)
  if (gitBacked) {
    return prepareGitWorktree(realSource)
  }
  const size = await directorySize(realSource)
  if (size > MAX_NONGIT_COPY_BYTES) {
    throw new Error(
      `工作目录超过 ${Math.round(MAX_NONGIT_COPY_BYTES / (1024 * 1024))}MB，且不是 Git 仓库，无法隔离运行`
    )
  }
  return prepareTempCopy(realSource)
}

async function makeTempDir(prefix: string): Promise<string> {
  const base = path.join(os.tmpdir(), 'studio-workspaces')
  await fs.mkdir(base, { recursive: true })
  return fs.mkdtemp(path.join(base, prefix))
}

async function prepareGitWorktree(sourceRoot: string): Promise<PreparedWorkspace> {
  const dir = await makeTempDir('wt-')
  // Detached worktree at the current HEAD; we then sync the dirty working tree
  // so uncommitted changes are part of the agent's starting point.
  await execFileAsync('git', ['worktree', 'add', '--detach', dir, 'HEAD'], {
    cwd: sourceRoot,
    timeout: 60_000
  })
  await syncWorkingTree(sourceRoot, dir)

  const baseline = await snapshotTree(dir)
  return {
    path: dir,
    isGitWorktree: true,
    sourceRoot,
    baseline,
    cleanup: async () => {
      try {
        await execFileAsync('git', ['worktree', 'remove', '--force', dir], {
          cwd: sourceRoot,
          timeout: 30_000
        })
      } catch {
        // Fall back to a raw delete if git refuses (e.g. already detached).
        await fs.rm(dir, { recursive: true, force: true })
      }
    }
  }
}

/**
 * Mirror the source working tree's non-excluded files into the worktree so
 * uncommitted edits are visible to the agent. Copies over the checked-out HEAD.
 */
async function syncWorkingTree(sourceRoot: string, dest: string): Promise<void> {
  await removeDestinationOnlyEntries(sourceRoot, dest)
  await copyTree(sourceRoot, dest)
}

/**
 * Remove files that exist in detached HEAD but were already deleted from the
 * user's working tree. Keep the worktree's own `.git` pointer intact.
 */
async function removeDestinationOnlyEntries(source: string, dest: string): Promise<void> {
  const entries = await fs.readdir(dest, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.git') continue
    const sourcePath = path.join(source, entry.name)
    const destPath = path.join(dest, entry.name)
    let sourceEntry
    try {
      sourceEntry = await fs.lstat(sourcePath)
    } catch {
      await fs.rm(destPath, { recursive: true, force: true })
      continue
    }
    if (entry.isDirectory()) {
      if (isExcludedDir(entry.name)) {
        await fs.rm(destPath, { recursive: true, force: true })
      } else if (sourceEntry.isDirectory()) {
        await removeDestinationOnlyEntries(sourcePath, destPath)
      } else {
        await fs.rm(destPath, { recursive: true, force: true })
      }
    } else if (sourceEntry.isDirectory()) {
      await fs.rm(destPath, { recursive: true, force: true })
    }
  }
}

async function prepareTempCopy(sourceRoot: string): Promise<PreparedWorkspace> {
  const dir = await makeTempDir('copy-')
  await copyTree(sourceRoot, dir, true)
  const baseline = await snapshotTree(dir)
  return {
    path: dir,
    isGitWorktree: false,
    sourceRoot,
    baseline,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true })
    }
  }
}

/** Recursively copy non-excluded files from `src` into `dest`. */
async function copyTree(src: string, dest: string, excludeDotDirs = false): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true })
  await fs.mkdir(dest, { recursive: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (isExcludedDir(entry.name) || (excludeDotDirs && entry.name.startsWith('.'))) continue
      await copyTree(path.join(src, entry.name), path.join(dest, entry.name), excludeDotDirs)
    } else if (entry.isFile()) {
      const from = path.join(src, entry.name)
      const to = path.join(dest, entry.name)
      try {
        await fs.copyFile(from, to)
      } catch {
        // Skip files we cannot copy (permissions, special files).
      }
    }
  }
}
