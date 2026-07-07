import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import type {
  AgentAvailability,
  DirEntry,
  HotkeyTriggerEvent,
  ProjectFileEntry,
  ProjectInfo,
  ResolvedColorScheme,
  SettingsPatch,
  TerminalSessionInfo
} from '../shared/types'
import { matchesHotkeyPress } from '../shared/hotkeys'
import { api } from './lib/api'
import { baseName } from './lib/fileKind'
import { recordRecentFile } from './lib/recentFiles'
import { usePanels } from './hooks/usePanels'
import { Resizer } from './components/Resizer'
import { Sidebar } from './components/Sidebar'
import {
  DocumentWorkspace,
  type OpenDocumentRequest
} from './components/DocumentWorkspace'
import { QuickOpen } from './components/QuickOpen'
import { RightPanel, type RightPanelHandle } from './components/RightPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { useAppearance } from './hooks/useAppearance'
import { useStudioSettings } from './hooks/useStudioSettings'

/**
 * Three-column document workbench: explorer · viewer · info/terminal.
 * Left and right panels collapse (⌘B / ⌘⌥B), resize by dragging, and reset on
 * double-click; their state persists via usePanels.
 */
export function App(): JSX.Element {
  const panels = usePanels()
  const { appearance, updateAppearance, replaceAppearance, resetAppearance } = useAppearance()
  const {
    settings,
    loading: settingsLoading,
    error: settingsError,
    updateSettings,
    resetAllSettings
  } = useStudioSettings()
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [roots, setRoots] = useState<DirEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [selected, setSelected] = useState<DirEntry | null>(null)
  const [openRequest, setOpenRequest] = useState<OpenDocumentRequest | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [quickOpenOpen, setQuickOpenOpen] = useState(false)
  const [windowFocused, setWindowFocused] = useState(() => document.hasFocus())
  const [systemColorScheme, setSystemColorScheme] = useState<ResolvedColorScheme>('light')
  const [agentAvailability, setAgentAvailability] = useState<AgentAvailability[]>([])
  const [terminalSessions, setTerminalSessions] = useState<TerminalSessionInfo[]>([])
  const [aiContextPaths, setAiContextPaths] = useState<string[]>([])
  const rightPanelRef = useRef<RightPanelHandle | null>(null)

  const loadRoots = useCallback(async (proj: ProjectInfo) => {
    setLoading(true)
    setTreeError(null)
    setSelected(null)
    setOpenRequest(null)
    setAiContextPaths([])
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

  useEffect(() => {
    if (settingsLoading) return
    replaceAppearance(settings.appearance)
    panels.replaceWidths(settings.layout.leftWidth, settings.layout.rightWidth)
  }, [
    panels.replaceWidths,
    replaceAppearance,
    settings.appearance,
    settings.layout.leftWidth,
    settings.layout.rightWidth,
    settingsLoading
  ])

  useEffect(() => api.onOpenSettings(() => setSettingsOpen(true)), [])

  useEffect(() => {
    void api
      .getSystemColorScheme()
      .then(setSystemColorScheme)
      .catch(() => {
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
          setSystemColorScheme('dark')
        }
      })
    return api.onSystemColorSchemeChange(setSystemColorScheme)
  }, [])

  useEffect(() => {
    const onFocus = (): void => setWindowFocused(true)
    const onBlur = (): void => setWindowFocused(false)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  useEffect(() => {
    void api.agentAvailability().then(setAgentAvailability).catch(() => setAgentAvailability([]))
  }, [settingsOpen])

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

  const selectFile = useCallback(
    (file: DirEntry) => {
      setSelected(file)
      setOpenRequest({ file, nonce: Date.now() })
      // Seed the AI context with the first opened document for a zero-setup start.
      setAiContextPaths((current) => (current.length === 0 ? [file.path] : current))
      if (project) recordRecentFile(project.root, file)
    },
    [project]
  )

  const addToAiContext = useCallback((entry: DirEntry) => {
    setAiContextPaths((current) =>
      current.includes(entry.path) ? current : [...current, entry.path]
    )
  }, [])

  const removeFromAiContext = useCallback((targetPath: string) => {
    setAiContextPaths((current) => current.filter((item) => item !== targetPath))
  }, [])

  const openAgentPath = useCallback(
    (relativePath: string) => {
      if (!project) return
      const absolute = `${project.root.replace(/\/$/, '')}/${relativePath.replace(/^\//, '')}`
      selectFile({
        name: baseName(relativePath),
        path: absolute,
        isDirectory: false,
        isSymbolicLink: false
      })
    },
    [project, selectFile]
  )

  const handleCopyRelativePath = useCallback(
    (relativePath: string) => {
      if (!settings.terminal.autoPastePath) return
      rightPanelRef.current?.pasteToActiveTerminal(`（${relativePath}）`)
    },
    [settings.terminal.autoPastePath]
  )

  const runHotkey = useCallback(
    (hotkey: HotkeyTriggerEvent) => {
      if (panels.rightCollapsed) panels.toggleRight()
      if (hotkey.action === 'focus-claude-terminal') {
        rightPanelRef.current?.focusOrOpenTerminal('claude')
      } else if (hotkey.action === 'focus-codex-terminal') {
        rightPanelRef.current?.focusOrOpenTerminal('codex')
      } else if (hotkey.presetText.trim()) {
        rightPanelRef.current?.pasteToActiveTerminal(hotkey.presetText)
      }
    },
    [panels]
  )

  useEffect(() => api.onHotkeyTrigger(runHotkey), [runHotkey])

  useEffect(() => {
    api.setHotkeysSuspended(settingsOpen)
    return () => api.setHotkeysSuspended(false)
  }, [settingsOpen])

  // Keyboard shortcuts: ⌘B toggles left, ⌘⌥B toggles right. Custom hotkeys also
  // have a renderer fallback; menu-conflicting combinations are caught in main.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (settingsOpen) return
      if (
        e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        (e.key === 'p' || e.key === 'P' || e.code === 'KeyP')
      ) {
        e.preventDefault()
        e.stopImmediatePropagation()
        setQuickOpenOpen((current) => !current)
        return
      }
      // While the quick-open palette is up, leave the keyboard to it.
      if (quickOpenOpen) return
      // Match by physical key too: on macOS Option+B yields key '∫', which
      // would otherwise break ⌘⌥B while Option is held.
      if (e.metaKey && (e.key === 'b' || e.key === 'B' || e.code === 'KeyB')) {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (e.altKey) panels.toggleRight()
        else panels.toggleLeft()
        return
      }
      const hotkey = settings.hotkeys.find((item) =>
        matchesHotkeyPress(
          {
            key: e.key,
            code: e.code,
            metaKey: e.metaKey,
            ctrlKey: e.ctrlKey,
            altKey: e.altKey,
            shiftKey: e.shiftKey
          },
          item,
          isMacPlatform()
        )
      )
      if (!hotkey) return
      e.preventDefault()
      e.stopImmediatePropagation()
      runHotkey(hotkey)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [panels, quickOpenOpen, runHotkey, settings.hotkeys, settingsOpen])

  const appearanceStyle = {
    '--panel-opacity': appearance.panelOpacity,
    '--panel-blur': `${appearance.blur}px`,
    '--motion-ms': `${appearance.animationMs}ms`,
    '--drawer-radius': `${appearance.radius}px`,
    '--drawer-inset': `${appearance.inset}px`,
    '--left-panel-width': `${panels.leftCollapsed ? 0 : panels.leftWidth}px`
  } as CSSProperties
  const resolvedColorScheme =
    appearance.colorScheme === 'system' ? systemColorScheme : appearance.colorScheme

  const changeSettings = (patch: SettingsPatch): void => {
    if (patch.appearance) updateAppearance(patch.appearance)
    if (patch.layout?.leftWidth !== undefined) panels.setLeftWidth(patch.layout.leftWidth)
    if (patch.layout?.rightWidth !== undefined) panels.setRightWidth(patch.layout.rightWidth)
    void updateSettings(patch)
  }

  const resetSettings = (): void => {
    resetAppearance()
    panels.resetAll()
    void resetAllSettings()
  }

  const loadTerminalSession = (sessionId: string): void => {
    if (panels.rightCollapsed) panels.toggleRight()
    rightPanelRef.current?.loadTerminalSession(sessionId)
    setSettingsOpen(false)
  }

  const deleteTerminalSessions = (sessionIds: string[]): void => {
    rightPanelRef.current?.deleteTerminalSessions(sessionIds)
  }

  const openQuickOpenPick = useCallback(
    (entry: ProjectFileEntry) => {
      selectFile({
        name: entry.name,
        path: entry.path,
        isDirectory: false,
        isSymbolicLink: false
      })
    },
    [selectFile]
  )

  return (
    <div
      className={`app theme-${resolvedColorScheme} ${
        windowFocused ? 'window-focused' : 'window-blurred'
      }`}
      style={appearanceStyle}
      data-color-scheme={resolvedColorScheme}
      data-color-source={appearance.colorScheme}
    >
      <div className="titlebar">
        <button
          className={`icon-btn${panels.leftCollapsed ? '' : ' active'}`}
          title={panels.leftCollapsed ? '显示文件栏 (⌘B)' : '收起文件栏 (⌘B)'}
          aria-pressed={!panels.leftCollapsed}
          onClick={panels.toggleLeft}
        >
          {panels.leftCollapsed ? (
            <PanelLeftOpen size={15} strokeWidth={1.8} />
          ) : (
            <PanelLeftClose size={15} strokeWidth={1.8} />
          )}
        </button>
        <span className="spacer" />
        <button
          className={`icon-btn${panels.rightCollapsed ? '' : ' active'}`}
          title={panels.rightCollapsed ? '显示右侧栏 (⌘⌥B)' : '收起右侧栏 (⌘⌥B)'}
          aria-pressed={!panels.rightCollapsed}
          onClick={panels.toggleRight}
        >
          {panels.rightCollapsed ? (
            <PanelRightOpen size={15} strokeWidth={1.8} />
          ) : (
            <PanelRightClose size={15} strokeWidth={1.8} />
          )}
        </button>
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
            onCopyRelativePath={handleCopyRelativePath}
            onAddToAiContext={addToAiContext}
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
          <RightPanel
            ref={rightPanelRef}
            project={project}
            settings={settings}
            colorScheme={resolvedColorScheme}
            availability={agentAvailability}
            contextPaths={aiContextPaths}
            onRemoveContextPath={removeFromAiContext}
            onOpenDocumentPath={openAgentPath}
            onSessionsChange={setTerminalSessions}
            onCollapse={panels.toggleRight}
          />
        </div>
      </div>

      <QuickOpen
        open={quickOpenOpen}
        projectRoot={project?.root ?? null}
        onPick={openQuickOpenPick}
        onClose={() => setQuickOpenOpen(false)}
      />

      <SettingsPanel
        open={settingsOpen}
        settings={{
          ...settings,
          appearance,
          layout: {
            leftWidth: panels.leftWidth,
            rightWidth: panels.rightWidth
          }
        }}
        availability={agentAvailability}
        terminalSessions={terminalSessions}
        loading={settingsLoading}
        error={settingsError}
        onChange={changeSettings}
        onReset={resetSettings}
        onLoadTerminalSession={loadTerminalSession}
        onDeleteTerminalSessions={deleteTerminalSessions}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  )
}

function isMacPlatform(): boolean {
  const isMac = navigator.platform.toLowerCase().includes('mac')
  return isMac
}
