import { useEffect, useState } from 'react'
import { Columns2, PanelLeft, X } from 'lucide-react'
import type { DirEntry } from '../../shared/types'
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
  request: OpenDocumentRequest | null
  onOpenExternal: (path: string) => void
}

export function DocumentWorkspace({
  request,
  onOpenExternal
}: DocumentWorkspaceProps): JSX.Element {
  const [panes, setPanes] = useState<PaneState[]>([
    { id: 'left', tabs: [], activePath: null }
  ])
  const [focusedPane, setFocusedPane] = useState<'left' | 'right'>('left')
  const [dirtyPaths, setDirtyPaths] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!request) return
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
