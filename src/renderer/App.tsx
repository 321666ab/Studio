import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { PanelLeftOpen, PanelRightOpen } from 'lucide-react'
import type {
  AgentAvailability,
  DirEntry,
  HotkeyTriggerEvent,
  ProjectInfo,
  ResolvedColorScheme,
  SettingsPatch,
  TerminalSessionInfo
} from '../shared/types'
import { matchesHotkeyPress } from '../shared/hotkeys'
import { api } from './lib/api'
import { usePanels } from './hooks/usePanels'
import { Resizer } from './components/Resizer'
import { Sidebar } from './components/Sidebar'
import {
  DocumentWorkspace,
  type OpenDocumentRequest
} from './components/DocumentWorkspace'
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
  const [windowFocused, setWindowFocused] = useState(() => document.hasFocus())
  const [systemColorScheme, setSystemColorScheme] = useState<ResolvedColorScheme>('light')
  const [agentAvailability, setAgentAvailability] = useState<AgentAvailability[]>([])
  const [terminalSessions, setTerminalSessions] = useState<TerminalSessionInfo[]>([])
  const rightPanelRef = useRef<RightPanelHandle | null>(null)

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

  const selectFile = useCallback((file: DirEntry) => {
    setSelected(file)
    setOpenRequest({ file, nonce: Date.now() })
  }, [])

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
      if (e.metaKey && (e.key === 'b' || e.key === 'B')) {
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
  }, [panels, runHotkey, settings.hotkeys, settingsOpen])

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
        {panels.leftCollapsed && (
          <button className="icon-btn" title="显示文件栏 (⌘B)" onClick={panels.toggleLeft}>
            <PanelLeftOpen size={15} strokeWidth={1.8} />
          </button>
        )}
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
            onCopyRelativePath={handleCopyRelativePath}
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
            onSessionsChange={setTerminalSessions}
            onCollapse={panels.toggleRight}
          />
        </div>
      </div>

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
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  )
}

function isMacPlatform(): boolean {
  const isMac = navigator.platform.toLowerCase().includes('mac')
  return isMac
}
