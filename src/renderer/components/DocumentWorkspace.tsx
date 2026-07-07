import { useEffect, useRef, useState } from 'react'
import { Columns2, PanelLeft, X } from 'lucide-react'
import type { DirEntry } from '../../shared/types'
import { api } from '../lib/api'
import {
  loadWorkspaceSession,
  saveWorkspaceSession,
  type WorkspaceSession
} from '../lib/workspaceSession'
import { Viewer } from './Viewer'

export interface OpenDocumentRequest {
  file: DirEntry
  nonce: number
}

interface PaneState {
  id: 'left' | 'right'
  tabs: DirEntry[]
  activePath: string | null
}

interface DocumentWorkspaceProps {
  projectRoot: string | null
  request: OpenDocumentRequest | null
  onOpenExternal: (path: string) => void
}

export function DocumentWorkspace({
  projectRoot,
  request,
  onOpenExternal
}: DocumentWorkspaceProps): JSX.Element {
  const [panes, setPanes] = useState<PaneState[]>([
    { id: 'left', tabs: [], activePath: null }
  ])
  const [focusedPane, setFocusedPane] = useState<'left' | 'right'>('left')
  const [dirtyPaths, setDirtyPaths] = useState<Record<string, boolean>>({})
  // Persistence stays off until the stored session has been restored (or found
  // absent), so the initial empty state never clobbers a saved one.
  const [sessionReady, setSessionReady] = useState(false)
  const restoreNonce = useRef(0)
  // Set as soon as the user opens a document; a slower async restore must not
  // overwrite what they are already looking at.
  const userOpenedRef = useRef(false)

  // Restore the previous tab set for this project; drop tabs whose files are
  // gone. The component remounts per project (keyed by root in App).
  useEffect(() => {
    if (!projectRoot) {
      setSessionReady(true)
      return
    }
    const nonce = (restoreNonce.current += 1)
    const stored = loadWorkspaceSession(projectRoot)
    if (!stored) {
      setSessionReady(true)
      return
    }
    void (async () => {
      const alive = new Set<string>()
      const paths = stored.panes.flatMap((pane) => pane.tabs.map((tab) => tab.path))
      await Promise.all(
        paths.map(async (path) => {
          try {
            const info = await api.getFileInfo(path)
            if (!info.isDirectory) alive.add(path)
          } catch {
            /* deleted or moved — drop the tab */
          }
        })
      )
      if (restoreNonce.current !== nonce) return
      if (userOpenedRef.current) {
        setSessionReady(true)
        return
      }
      const panes: PaneState[] = stored.panes
        .map((pane) => {
          const tabs = pane.tabs
            .filter((tab) => alive.has(tab.path))
            .map((tab) => ({
              name: tab.name,
              path: tab.path,
              isDirectory: false,
              isSymbolicLink: false
            }))
          const activePath =
            pane.activePath && tabs.some((tab) => tab.path === pane.activePath)
              ? pane.activePath
              : (tabs[0]?.path ?? null)
          return { id: pane.id, tabs, activePath }
        })
        // A restored right pane with no surviving tabs closes the split.
        .filter((pane) => pane.id === 'left' || pane.tabs.length > 0)
      if (panes.length > 0 && panes.some((pane) => pane.tabs.length > 0)) {
        setPanes(panes)
        setFocusedPane(panes.some((pane) => pane.id === stored.focusedPane) ? stored.focusedPane : 'left')
      }
      setSessionReady(true)
    })()
  }, [projectRoot])

  useEffect(() => {
    if (!projectRoot || !sessionReady) return
    const session: WorkspaceSession = {
      panes: panes.map((pane) => ({
        id: pane.id,
        tabs: pane.tabs.map((tab) => ({ name: tab.name, path: tab.path })),
        activePath: pane.activePath
      })),
      focusedPane
    }
    saveWorkspaceSession(projectRoot, session)
  }, [focusedPane, panes, projectRoot, sessionReady])

  useEffect(() => {
    if (!request) return
    userOpenedRef.current = true
    const existingPane = panes.find((pane) =>
      pane.tabs.some((tab) => tab.path === request.file.path)
    )
    if (existingPane) {
      setFocusedPane(existingPane.id)
      setPanes((current) =>
        current.map((pane) =>
          pane.id === existingPane.id ? { ...pane, activePath: request.file.path } : pane
        )
      )
      return
    }
    setPanes((current) =>
      current.map((pane) => {
        if (pane.id !== focusedPane) return pane
        const exists = pane.tabs.some((tab) => tab.path === request.file.path)
        return {
          ...pane,
          tabs: exists ? pane.tabs : [...pane.tabs, request.file],
          activePath: request.file.path
        }
      })
    )
  }, [request])

  const split = (): void => {
    setPanes((current) => {
      if (current.length === 2) return current
      return [...current, { id: 'right', tabs: [], activePath: null }]
    })
    setFocusedPane('right')
  }

  const closeSplit = (): void => {
    const rightPane = panes.find((pane) => pane.id === 'right')
    const dirtyFiles = rightPane?.tabs.filter((tab) => dirtyPaths[tab.path]) ?? []
    if (
      dirtyFiles.length > 0 &&
      !window.confirm(`右侧分屏有 ${dirtyFiles.length} 个未保存文档，仍要关闭吗？`)
    ) {
      return
    }
    if (rightPane) {
      setDirtyPaths((current) => {
        const next = { ...current }
        for (const tab of rightPane.tabs) delete next[tab.path]
        return next
      })
    }
    setPanes((current) => current.filter((pane) => pane.id === 'left'))
    setFocusedPane('left')
  }

  const activate = (paneId: PaneState['id'], path: string): void => {
    setFocusedPane(paneId)
    setPanes((current) =>
      current.map((pane) => (pane.id === paneId ? { ...pane, activePath: path } : pane))
    )
  }

  // ⌘⇧[ / ⌘⇧] and Ctrl(+Shift)+Tab cycle tabs within the focused pane.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const isBracket =
        e.metaKey &&
        e.shiftKey &&
        !e.altKey &&
        !e.ctrlKey &&
        (e.code === 'BracketLeft' || e.code === 'BracketRight')
      const isCtrlTab = e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Tab'
      if (!isBracket && !isCtrlTab) return
      const pane = panes.find((item) => item.id === focusedPane) ?? panes[0]
      if (!pane || pane.tabs.length < 2 || !pane.activePath) return
      e.preventDefault()
      e.stopImmediatePropagation()
      const delta = isBracket ? (e.code === 'BracketRight' ? 1 : -1) : e.shiftKey ? -1 : 1
      const index = pane.tabs.findIndex((tab) => tab.path === pane.activePath)
      const next = pane.tabs[(index + delta + pane.tabs.length) % pane.tabs.length]
      activate(pane.id, next.path)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [panes, focusedPane])

  const closeTab = (paneId: PaneState['id'], path: string): void => {
    if (dirtyPaths[path] && !window.confirm('此 Markdown 文档尚未保存，仍要关闭吗？')) return
    setDirtyPaths((current) => {
      const next = { ...current }
      delete next[path]
      return next
    })
    setPanes((current) =>
      current.map((pane) => {
        if (pane.id !== paneId) return pane
        const index = pane.tabs.findIndex((tab) => tab.path === path)
        const tabs = pane.tabs.filter((tab) => tab.path !== path)
        const activePath =
          pane.activePath === path
            ? (tabs[Math.min(index, tabs.length - 1)]?.path ?? null)
            : pane.activePath
        return { ...pane, tabs, activePath }
      })
    )
  }

  return (
    <div className={`document-workspace${panes.length === 2 ? ' split' : ''}`}>
      {panes.map((pane) => {
        return (
          <section
            key={pane.id}
            className={`document-pane${focusedPane === pane.id ? ' focused' : ''}`}
            onMouseDown={() => setFocusedPane(pane.id)}
          >
            <header className="document-tabs">
              <div className="document-tab-strip">
                {pane.tabs.map((tab) => (
                  <button
                    key={tab.path}
                    className={`document-tab${pane.activePath === tab.path ? ' active' : ''}`}
                    title={tab.path}
                    onClick={() => activate(pane.id, tab.path)}
                  >
                    <span>{tab.name}</span>
                    {dirtyPaths[tab.path] && <i className="document-tab-dirty" title="未保存" />}
                    <span
                      className="document-tab-close"
                      role="button"
                      title="关闭标签"
                      onClick={(event) => {
                        event.stopPropagation()
                        closeTab(pane.id, tab.path)
                      }}
                    >
                      <X size={12} strokeWidth={2} />
                    </span>
                  </button>
                ))}
              </div>
              <div className="document-pane-actions">
                {panes.length === 1 ? (
                  <button className="icon-btn" title="左右分屏" onClick={split}>
                    <Columns2 size={15} strokeWidth={1.8} />
                  </button>
                ) : pane.id === 'right' ? (
                  <button className="icon-btn" title="关闭分屏" onClick={closeSplit}>
                    <PanelLeft size={15} strokeWidth={1.8} />
                  </button>
                ) : null}
              </div>
            </header>
            <div className="pane-document-stack">
              {pane.tabs.length === 0 && (
                <Viewer
                  file={null}
                  focused={focusedPane === pane.id}
                  onOpenExternal={onOpenExternal}
                />
              )}
              {pane.tabs.map((tab) => (
                <div
                  key={tab.path}
                  className={`pane-document${pane.activePath === tab.path ? ' active' : ''}`}
                >
                  <Viewer
                    file={tab}
                    focused={focusedPane === pane.id && pane.activePath === tab.path}
                    onOpenExternal={onOpenExternal}
                    onDirtyChange={(path, dirty) =>
                      setDirtyPaths((current) =>
                        current[path] === dirty ? current : { ...current, [path]: dirty }
                      )
                    }
                  />
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
