/**
 * Per-project recently-opened-file history backing the ⌘P palette's
 * "最近打开" group. Stored in localStorage, most recent first.
 */

export interface RecentFile {
  name: string
  path: string
  relativePath: string
}

export const RECENT_FILES_LIMIT = 15
const STORAGE_PREFIX = 'studio.recentFiles.v1:'

/** Pure core: prepend `entry`, dropping earlier occurrences, capped at `limit`. */
export function pushRecent(
  list: readonly RecentFile[],
  entry: RecentFile,
  limit = RECENT_FILES_LIMIT
): RecentFile[] {
  const next = [entry, ...list.filter((item) => item.path !== entry.path)]
  return next.slice(0, limit)
}

export function getRecentFiles(root: string): RecentFile[] {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + root)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is RecentFile =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as RecentFile).name === 'string' &&
        typeof (item as RecentFile).path === 'string' &&
        typeof (item as RecentFile).relativePath === 'string'
    )
  } catch {
    return []
  }
}

export function recordRecentFile(root: string, file: { name: string; path: string }): void {
  const cleanRoot = root.replace(/\/$/, '')
  const relativePath = file.path.startsWith(cleanRoot + '/')
    ? file.path.slice(cleanRoot.length + 1)
    : file.path
  const entry: RecentFile = { name: file.name, path: file.path, relativePath }
  try {
    localStorage.setItem(
      STORAGE_PREFIX + root,
      JSON.stringify(pushRecent(getRecentFiles(root), entry))
    )
  } catch {
    // Quota/serialization failures just mean no recents — never break opening.
  }
}
