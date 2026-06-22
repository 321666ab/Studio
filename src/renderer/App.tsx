import { type CSSProperties, useCallback, useEffect, useState } from 'react'
import { PanelLeftOpen, PanelRightOpen } from 'lucide-react'
import type { DirEntry, ProjectInfo } from '../shared/types'
import { api } from './lib/api'
import { baseName } from './lib/fileKind'
import { usePanels } from './hooks/usePanels'
import { Resizer } from './components/Resizer'
import { Sidebar } from './components/Sidebar'
import {
  DocumentWorkspace,
  type OpenDocumentRequest
} from './components/DocumentWorkspace'
import { RightPanel } from './components/RightPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { useAppearance } from './hooks/useAppearance'

/**
 * Three-column document workbench: explorer · viewer · info/terminal.
 * Left and right panels collapse (⌘B / ⌘⌥B), resize by dragging, and reset on
 * double-click; their state persists via usePanels.
 */
export function App(): JSX.Element {
  const panels = usePanels()
  const { appearance, updateAppearance, resetAppearance } = useAppearance()
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [roots, setRoots] = useState<DirEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [selected, setSelected] = useState<DirEntry | null>(null)
  const [openRequest, setOpenRequest] = useState<OpenDocumentRequest | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const loadRoots = useCallback(async (proj: ProjectInfo) => {
    setLoading(true)
    setTreeError(null)
    setSelected(null)
    setOpenRequest(null)
    try {
      setRoots(await api.readDir(proj.root))
    } catch (e) {
      setRoots([])
      setTreeError(e instanceof Error ? e.message : '读取文件夹失败')
    } finally {
      setLoading(false)
    }
  }, [])

  // Restore an already-open project on mount.
  useEffect(() => {
    api
      .getCurrentProject()
      .then((proj) => {
        if (proj) {
          setProject(proj)
          void loadRoots(proj)
        }
      })
      .catch(() => {
        /* nothing open yet */
      })
  }, [loadRoots])

  const openProject = useCallback(async () => {
    setTreeError(null)
    try {
      const proj = await api.selectProject()
      if (proj) {
        setProject(proj)
        void loadRoots(proj)
      }
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : '无法打开文件夹选择器')
    }
  }, [loadRoots])

  const openExternal = useCallback((path: string) => {
    void api.openPath(path).catch(() => undefined)
  }, [])

  const selectFile = useCallback((file: DirEntry) => {
    setSelected(file)
    setOpenRequest({ file, nonce: Date.now() })
  }, [])

  // Keyboard shortcuts: ⌘B toggles left, ⌘⌥B toggles right.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey && (e.key === 'b' || e.key === 'B'))) return
      e.preventDefault()
      if (e.altKey) panels.toggleRight()
      else panels.toggleLeft()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panels])

  const appearanceStyle = {
    '--panel-opacity': appearance.panelOpacity,
    '--panel-blur': `${appearance.blur}px`,
    '--motion-ms': `${appearance.animationMs}ms`,
    '--drawer-radius': `${appearance.radius}px`,
    '--drawer-inset': `${appearance.inset}px`
  } as CSSProperties

  const resetSettings = (): void => {
    resetAppearance()
    panels.setLeftWidth(280)
    panels.setRightWidth(320)
  }

  return (
    <div className="app" style={appearanceStyle}>
      <div className="titlebar">
        {panels.leftCollapsed && (
          <button className="icon-btn" title="显示文件栏 (⌘B)" onClick={panels.toggleLeft}>
            <PanelLeftOpen size={15} strokeWidth={1.8} />
          </button>
        )}
        <span className="title">
          {project ? project.name : 'Studio'}
          {selected ? ` — ${baseName(selected.path)}` : ''}
        </span>
        <span className="spacer" />
        {panels.rightCollapsed && (
          <button className="icon-btn" title="显示右侧栏 (⌘⌥B)" onClick={panels.toggleRight}>
            <PanelRightOpen size={15} strokeWidth={1.8} />
          </button>
        )}
      </div>

      <div className="workspace">
        <div
          className={`col col-left${panels.leftCollapsed ? ' collapsed' : ''}`}
          style={{ width: panels.leftCollapsed ? 0 : panels.leftWidth }}
        >
          <Sidebar
            project={project}
            roots={roots}
            loading={loading}
            error={treeError}
            selectedPath={selected?.path ?? null}
            onOpenProject={openProject}
            onSelectFile={selectFile}
            onCollapse={panels.toggleLeft}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </div>
        {!panels.leftCollapsed && (
          <Resizer
            width={panels.leftWidth}
            side="left"
            onResize={panels.setLeftWidth}
            onReset={panels.resetLeft}
          />
        )}

        <div className="col col-center">
          <DocumentWorkspace
            key={project?.root ?? 'no-project'}
            request={openRequest}
            onOpenExternal={openExternal}
          />
        </div>

        {!panels.rightCollapsed && (
          <Resizer
            width={panels.rightWidth}
            side="right"
            onResize={panels.setRightWidth}
            onReset={panels.resetRight}
          />
        )}
        <div
          className={`col col-right${panels.rightCollapsed ? ' collapsed' : ''}`}
          style={{ width: panels.rightCollapsed ? 0 : panels.rightWidth }}
        >
          <RightPanel project={project} onCollapse={panels.toggleRight} />
        </div>
      </div>

      <SettingsPanel
        open={settingsOpen}
        appearance={appearance}
        leftWidth={panels.leftWidth}
        rightWidth={panels.rightWidth}
        onAppearanceChange={updateAppearance}
        onLeftWidthChange={panels.setLeftWidth}
        onRightWidthChange={panels.setRightWidth}
        onReset={resetSettings}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  )
}
