import { promises as fs } from 'fs'
import path from 'path'

/**
 * Names that are always hidden from the directory tree and never traversable.
 * Dotfiles (anything starting with `.`) are filtered separately.
 */
export const IGNORED_NAMES = new Set<string>([
  'node_modules',
  '.git',
  '.cache',
  '__pycache__',
  '.DS_Store',
  '.next',
  '.turbo',
  '.parcel-cache',
  'dist',
  'out'
])

/** Directory/file names whose contents should never appear in the tree. */
const CACHE_DIR_NAMES = new Set<string>([
  'node_modules',
  '.cache',
  '__pycache__',
  '.next',
  '.turbo',
  '.parcel-cache'
])

/**
 * Returns true if a directory entry name should be excluded from the tree:
 * any dotfile, or a known cache / vcs / build directory.
 */
export function isIgnoredEntry(name: string): boolean {
  if (name.startsWith('.')) return true
  if (IGNORED_NAMES.has(name)) return true
  if (CACHE_DIR_NAMES.has(name)) return true
  return false
}

/**
 * Determine whether `child` is contained within `root` (or equals it),
 * using normalized absolute paths. Both inputs must already be absolute.
 */
export function isWithinRoot(root: string, child: string): boolean {
  const normalizedRoot = path.resolve(root)
  const normalizedChild = path.resolve(child)
  if (normalizedChild === normalizedRoot) return true
  const rootWithSep = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : normalizedRoot + path.sep
  return normalizedChild.startsWith(rootWithSep)
}

/**
 * Resolve a target path to its real (symlink-followed) location and verify it
 * lies inside the project root, whose realpath is computed too. Throws on any
 * boundary violation or if the target does not exist.
 *
 * This is the single chokepoint every filesystem operation must pass through:
 * realpath first, then containment check, so out-of-bounds symlinks are rejected.
 */
export async function resolveWithinRoot(root: string, target: string): Promise<string> {
  const realRoot = await fs.realpath(root)
  const absoluteTarget = path.isAbsolute(target) ? target : path.resolve(realRoot, target)

  let realTarget: string
  try {
    realTarget = await fs.realpath(absoluteTarget)
  } catch {
    // Target may not exist yet; resolve the deepest existing ancestor so we can
    // still enforce containment (e.g. for fileInfo on a broken path).
    realTarget = await realpathOfNearestParent(absoluteTarget)
  }

  if (!isWithinRoot(realRoot, realTarget)) {
    throw new Error('Path escapes project root')
  }
  return realTarget
}

/**
 * Walk up from `target` until an existing ancestor is found, realpath it, then
 * re-append the non-existent tail. Used to validate paths that may not exist.
 */
async function realpathOfNearestParent(target: string): Promise<string> {
  let current = target
  const tail: string[] = []
  // Guard against infinite loops at the filesystem root.
  while (true) {
    const parent = path.dirname(current)
    if (parent === current) {
      // Reached filesystem root without finding anything.
      return path.join(target)
    }
    // Record the current segment so it is reattached to the resolved ancestor;
    // without this the non-existent leaf name is lost when its parent exists.
    tail.push(path.basename(current))
    try {
      const realParent = await fs.realpath(parent)
      return path.join(realParent, ...tail.reverse())
    } catch {
      current = parent
    }
  }
}
