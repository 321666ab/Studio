/**
 * Per-project persistence of the document workspace: which tabs are open in
 * each pane, the active tab, and the focused pane. Stored in localStorage so
 * a relaunch restores the previous working set.
 */

export interface SessionTab {
  name: string
  path: string
}

export interface PaneSession {
  id: 'left' | 'right'
  tabs: SessionTab[]
  activePath: string | null
}

export interface WorkspaceSession {
  panes: PaneSession[]
  focusedPane: 'left' | 'right'
}

const STORAGE_PREFIX = 'studio.workspaceSession.v1:'
/** Hard cap so a corrupt entry can never restore hundreds of tabs. */
const MAX_TABS_PER_PANE = 30

/** Pure core: parse and validate a stored session, or null when malformed. */
export function parseWorkspaceSession(raw: string): WorkspaceSession | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const candidate = parsed as Partial<WorkspaceSession>
  if (!Array.isArray(candidate.panes)) return null
  if (candidate.focusedPane !== 'left' && candidate.focusedPane !== 'right') return null

  const panes: PaneSession[] = []
  for (const pane of candidate.panes) {
    if (typeof pane !== 'object' || pane === null) return null
    const { id, tabs, activePath } = pane as Partial<PaneSession>
    if (id !== 'left' && id !== 'right') return null
    if (panes.some((existing) => existing.id === id)) return null
    if (!Array.isArray(tabs)) return null
    const validTabs = tabs
      .filter(
        (tab): tab is SessionTab =>
          typeof tab === 'object' &&
          tab !== null &&
          typeof (tab as SessionTab).name === 'string' &&
          typeof (tab as SessionTab).path === 'string'
      )
      .slice(0, MAX_TABS_PER_PANE)
    panes.push({
      id,
      tabs: validTabs,
      activePath:
        typeof activePath === 'string' && validTabs.some((tab) => tab.path === activePath)
          ? activePath
          : (validTabs[0]?.path ?? null)
    })
  }
  // The left pane must exist and come first; a lone right pane is meaningless.
  if (panes.length === 0 || panes[0].id !== 'left') return null
  const focusedPane = panes.some((pane) => pane.id === candidate.focusedPane)
    ? candidate.focusedPane
    : 'left'
  return { panes, focusedPane }
}

export function loadWorkspaceSession(root: string): WorkspaceSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + root)
    if (!raw) return null
    return parseWorkspaceSession(raw)
  } catch {
    return null
  }
}

export function saveWorkspaceSession(root: string, session: WorkspaceSession): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + root, JSON.stringify(session))
  } catch {
    // Quota/serialization failures just mean no restore — never break the app.
  }
}
