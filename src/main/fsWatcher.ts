import { watch, type FSWatcher } from 'fs'
import path from 'path'
import { isIgnoredEntry } from './security.js'

/** Change events are batched and emitted after this quiet period. */
export const FLUSH_DELAY_MS = 250
/** Above this many distinct directories per batch, collapse to a full refresh. */
export const MAX_DIRS_PER_FLUSH = 40
/** Sentinel meaning "refresh everything expanded" (event storm, e.g. git checkout). */
export const REFRESH_ALL = '*'

/**
 * Pure: map a recursive-watch event filename (relative to root) to the
 * directory whose listing changed, or null when the event lies in an ignored
 * subtree (node_modules, dotfiles, …) that the tree never displays.
 */
export function changedDirFor(root: string, filename: string | null): string | null {
  if (!filename) return root
  const segments = filename.split(path.sep).filter(Boolean)
  if (segments.length === 0) return root
  if (segments.some((segment) => isIgnoredEntry(segment))) return null
  return path.join(root, ...segments.slice(0, -1))
}

/**
 * Watches the open project root recursively (FSEvents on macOS) and reports
 * which directories need re-listing, debounced and deduplicated. Terminal
 * agents editing project files are the main producer of these events.
 */
export class ProjectWatcher {
  private watcher: FSWatcher | null = null
  private pending = new Set<string>()
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly emit: (dirs: string[]) => void) {}

  start(root: string): void {
    this.stop()
    try {
      this.watcher = watch(root, { recursive: true }, (_event, filename) => {
        const dir = changedDirFor(root, filename === null ? null : filename.toString())
        if (dir === null) return
        if (this.pending.size >= MAX_DIRS_PER_FLUSH) {
          this.pending.clear()
          this.pending.add(REFRESH_ALL)
        } else if (!this.pending.has(REFRESH_ALL)) {
          this.pending.add(dir)
        }
        this.timer ??= setTimeout(() => this.flush(), FLUSH_DELAY_MS)
      })
      // A dead watcher (e.g. root deleted) simply disables auto-refresh.
      this.watcher.on('error', () => this.stop())
    } catch {
      this.watcher = null
    }
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending.clear()
  }

  private flush(): void {
    this.timer = null
    if (this.pending.size === 0) return
    const dirs = [...this.pending]
    this.pending.clear()
    this.emit(dirs)
  }
}
