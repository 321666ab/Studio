import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  Bot,
  Code2,
  Columns2,
  PanelRightClose,
  Plus,
  TerminalSquare,
  Trash2,
  X
} from 'lucide-react'
import type { ProjectInfo, PtyAgent, Settings, TerminalSessionInfo } from '../../shared/types'
import {
  TerminalView,
  type TerminalTaskStatus,
  type TerminalViewHandle
} from './TerminalView'

interface TerminalPane {
  id: string
  status: TerminalTaskStatus
}

interface TerminalTab {
  id: string
  agent: PtyAgent
  label: string
  panes: TerminalPane[]
}

export interface RightPanelHandle {
  focusOrOpenTerminal: (agent: PtyAgent) => boolean
  loadTerminalSession: (sessionId: string) => boolean
  pasteToActiveTerminal: (text: string) => boolean
}

interface RightPanelProps {
  project: ProjectInfo | null
  settings: Settings
  onSessionsChange: (sessions: TerminalSessionInfo[]) => void
  onCollapse: () => void
}

const STATUS_LABEL: Record<TerminalTaskStatus, string> = {
  starting: '启动中',
  idle: '空闲',
  active: '活跃',
  exited: '已退出',
  error: '错误'
}
const SESSION_HISTORY_KEY = 'studio.terminalSessions.v1'
const SESSION_HISTORY_LIMIT = 30

export const RightPanel = forwardRef<RightPanelHandle, RightPanelProps>(function RightPanel(
  { project, settings, onSessionsChange, onCollapse },
  ref
): JSX.Element {
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [sessionHistory, setSessionHistory] = useState<TerminalSessionInfo[]>(loadSessionHistory)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activePaneId, setActivePaneId] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const terminalNumber = useRef(0)
  const terminalRefs = useRef<Map<string, TerminalViewHandle>>(new Map())

  useEffect(() => {
    setTabs([])
    setActiveId(null)
    setActivePaneId(null)
    setPickerOpen(false)
    setRenamingId(null)
    setMessage(null)
    terminalNumber.current = 0
  }, [project?.root])

  useEffect(() => {
    try {
      localStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(sessionHistory))
    } catch {
      // Non-critical persistence failure.
    }
  }, [sessionHistory])

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeId) ?? null,
    [activeId, tabs]
  )

  useEffect(() => {
    const activeSessions = tabs.map((tab) => toSessionInfo(tab, activeId))
    const activeIds = new Set(activeSessions.map((session) => session.id))
    onSessionsChange([
      ...activeSessions,
      ...sessionHistory.filter((session) => !activeIds.has(session.id))
    ])
  }, [activeId, onSessionsChange, sessionHistory, tabs])

  const rememberSession = useCallback((session: TerminalSessionInfo): void => {
    setSessionHistory((current) => {
      const next = [
        session,
        ...current.filter((item) => item.id !== session.id)
      ].slice(0, SESSION_HISTORY_LIMIT)
      return next
    })
  }, [])

  const resolveActivePaneId = useCallback((): string | null => {
    const ownsActivePane = tabs.some((tab) =>
      tab.panes.some((pane) => pane.id === activePaneId)
    )
    if (ownsActivePane) return activePaneId
    return activeTab?.panes[0]?.id ?? null
  }, [activePaneId, activeTab, tabs])

  const focusPaneSoon = useCallback((paneId: string | null | undefined): void => {
    if (!paneId) return
    window.setTimeout(() => terminalRefs.current.get(paneId)?.focus(), 0)
    window.setTimeout(() => terminalRefs.current.get(paneId)?.focus(), 80)
  }, [])

  const openTerminal = useCallback((agent: PtyAgent, preferredLabel?: string): string => {
    terminalNumber.current += 1
    const number = terminalNumber.current
    const id = `${agent}-${number}`
    const paneId = `${id}-pane-1`
    const tab: TerminalTab = {
      id,
      agent,
      label: preferredLabel?.trim().slice(0, 40) || `${agent === 'claude' ? 'Claude' : 'Codex'} ${number}`,
      panes: [{ id: paneId, status: 'starting' }]
    }
    setTabs((current) => [...current, tab])
    setActiveId(id)
    setActivePaneId(paneId)
    setPickerOpen(false)
    setMessage(null)
    rememberSession(toSessionInfo(tab, id))
    focusPaneSoon(paneId)
    return id
  }, [focusPaneSoon, rememberSession])

  const focusOrOpenTerminal = useCallback(
    (agent: PtyAgent): boolean => {
      const existing = [...tabs].reverse().find((tab) => tab.agent === agent)
      if (existing) {
        const paneId = existing.panes[0]?.id ?? null
        setActiveId(existing.id)
        setActivePaneId(paneId)
        setPickerOpen(false)
        setMessage(null)
        focusPaneSoon(paneId)
        return true
      }
      openTerminal(agent)
      return true
    },
    [focusPaneSoon, openTerminal, tabs]
  )

  const loadTerminalSession = useCallback(
    (sessionId: string): boolean => {
      const existing = tabs.find((tab) => tab.id === sessionId)
      if (existing) {
        const paneId = existing.panes[0]?.id ?? null
        setActiveId(existing.id)
        setActivePaneId(paneId)
        setPickerOpen(false)
        setMessage(null)
        focusPaneSoon(paneId)
        return true
      }
      const historical = sessionHistory.find((session) => session.id === sessionId)
      if (!historical) {
        setMessage('未找到该历史会话。')
        return false
      }
      openTerminal(historical.agent, historical.label)
      return true
    },
    [focusPaneSoon, openTerminal, sessionHistory, tabs]
  )

  const pasteToActiveTerminal = useCallback(
    (text: string): boolean => {
      const paneId = resolveActivePaneId()
      if (!paneId) {
        setMessage('没有活跃终端，已仅复制到剪贴板。')
        return false
      }
      window.studio.pty.input(paneId, text)
      setActivePaneId(paneId)
      setMessage(null)
      focusPaneSoon(paneId)
      return true
    },
    [focusPaneSoon, resolveActivePaneId]
  )

  useImperativeHandle(
    ref,
    () => ({
      focusOrOpenTerminal,
      loadTerminalSession,
      pasteToActiveTerminal
    }),
    [focusOrOpenTerminal, loadTerminalSession, pasteToActiveTerminal]
  )

  const closeTab = (id: string): void => {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.id === id)
      const closing = current[index]
      const next = current.filter((tab) => tab.id !== id)
      if (closing) {
        closing.panes.forEach((pane) => window.studio.pty.dispose(pane.id))
        rememberSession({ ...toSessionInfo(closing, activeId), status: 'closed', active: false, closed: true, updatedAt: Date.now() })
      }
      if (activeId === id) {
        const fallback = next[Math.min(index, next.length - 1)] ?? null
        setActiveId(fallback?.id ?? null)
        setActivePaneId(fallback?.panes[0]?.id ?? null)
      } else if (closing?.panes.some((pane) => pane.id === activePaneId)) {
        setActivePaneId(activeTab?.panes[0]?.id ?? null)
      }
      return next
    })
    if (renamingId === id) setRenamingId(null)
  }

  const closePane = (tabId: string, paneId: string): void => {
    setTabs((current) => {
      const tab = current.find((item) => item.id === tabId)
      if (!tab) return current
      if (tab.panes.length <= 1) {
        window.studio.pty.dispose(paneId)
        rememberSession({ ...toSessionInfo(tab, activeId), status: 'closed', active: false, closed: true, updatedAt: Date.now() })
        const next = current.filter((item) => item.id !== tabId)
        const fallback = next[0] ?? null
        if (activeId === tabId) {
          setActiveId(fallback?.id ?? null)
          setActivePaneId(fallback?.panes[0]?.id ?? null)
        }
        return next
      }
      window.studio.pty.dispose(paneId)
      const closingPaneIndex = tab.panes.findIndex((pane) => pane.id === paneId)
      rememberSession(toClosedPaneSession(tab, paneId, closingPaneIndex))
      return current.map((item) => {
        if (item.id !== tabId) return item
        const panes = item.panes.filter((pane) => pane.id !== paneId)
        if (activePaneId === paneId) setActivePaneId(panes[0]?.id ?? null)
        return { ...item, panes }
      })
    })
  }

  const closeInactiveSessions = (): void => {
    setTabs((current) => {
      const next = current.filter((tab) => {
        const status = aggregateStatus(tab.panes)
        const shouldClose = status === 'exited' || status === 'error'
        if (shouldClose) {
          tab.panes.forEach((pane) => window.studio.pty.dispose(pane.id))
          rememberSession({ ...toSessionInfo(tab, activeId), status: 'closed', active: false, closed: true, updatedAt: Date.now() })
        }
        return !shouldClose
      })
      if (!next.some((tab) => tab.id === activeId)) {
        setActiveId(next[0]?.id ?? null)
        setActivePaneId(next[0]?.panes[0]?.id ?? null)
      }
      return next
    })
  }

  const updatePaneStatus = (
    tabId: string,
    paneId: string,
    status: TerminalTaskStatus
  ): void => {
    setTabs((current) =>
      current.map((tab) =>
        tab.id !== tabId
          ? tab
          : {
              ...tab,
              panes: tab.panes.map((pane) => (pane.id === paneId ? { ...pane, status } : pane))
            }
      )
    )
  }

  const toggleSplit = (): void => {
    if (!activeId) return
    setTabs((current) =>
      current.map((tab) => {
        if (tab.id !== activeId) return tab
        if (tab.panes.length > 1) {
          const paneToClose = tab.panes[1]
          window.studio.pty.dispose(paneToClose.id)
          rememberSession(toClosedPaneSession(tab, paneToClose.id, 1))
          setActivePaneId(tab.panes[0]?.id ?? null)
          return { ...tab, panes: [tab.panes[0]] }
        }
        const pane = { id: `${tab.id}-pane-2`, status: 'starting' as TerminalTaskStatus }
        setActivePaneId(pane.id)
        return { ...tab, panes: [...tab.panes, pane] }
      })
    )
  }

  const startRename = (tab: TerminalTab): void => {
    setRenamingId(tab.id)
    setRenameValue(tab.label)
  }

  const commitRename = (): void => {
    if (!renamingId) return
    const label = renameValue.trim().slice(0, 40)
    if (label) {
      setTabs((current) =>
        current.map((tab) => {
          if (tab.id !== renamingId) return tab
          const next = { ...tab, label }
          rememberSession(toSessionInfo(next, activeId))
          return next
        })
      )
    }
    setRenamingId(null)
  }

  return (
    <>
      <div className="right-panel-head terminal-only">
        <div className="right-panel-title">
          <TerminalSquare size={14} strokeWidth={1.9} />
          <span>终端</span>
        </div>
        <div className="right-tabs">
          {tabs.map((tab) => {
            const status = aggregateStatus(tab.panes)
            const AgentIcon = tab.agent === 'claude' ? Bot : Code2
            return (
              <div
                key={tab.id}
                className={`right-tab${activeId === tab.id ? ' active' : ''}`}
                role="button"
                tabIndex={0}
                title={`${tab.label} · ${STATUS_LABEL[status]} · 双击重命名`}
                onClick={() => {
                  const paneId = tab.panes[0]?.id ?? null
                  setActiveId(tab.id)
                  setActivePaneId(paneId)
                  focusPaneSoon(paneId)
                }}
                onDoubleClick={() => startRename(tab)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    const paneId = tab.panes[0]?.id ?? null
                    setActiveId(tab.id)
                    setActivePaneId(paneId)
                    focusPaneSoon(paneId)
                  }
                }}
              >
                <AgentIcon size={13} strokeWidth={1.9} />
                {renamingId === tab.id ? (
                  <input
                    className="right-tab-rename"
                    value={renameValue}
                    autoFocus
                    maxLength={40}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setRenameValue(event.currentTarget.value)}
                    onBlur={commitRename}
                    onKeyDown={(event) => {
                      event.stopPropagation()
                      if (event.key === 'Enter') commitRename()
                      if (event.key === 'Escape') setRenamingId(null)
                    }}
                  />
                ) : (
                  <span className="right-tab-label">{tab.label}</span>
                )}
                <span className={`terminal-status ${status}`} title={STATUS_LABEL[status]}>
                  <i />
                  {STATUS_LABEL[status]}
                </span>
                <span
                  className="right-tab-close"
                  role="button"
                  tabIndex={0}
                  aria-label={`关闭 ${tab.label}`}
                  title="关闭标签"
                  onClick={(event) => {
                    event.stopPropagation()
                    closeTab(tab.id)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      event.stopPropagation()
                      closeTab(tab.id)
                    }
                  }}
                >
                  <X size={12} strokeWidth={2} />
                </span>
              </div>
            )
          })}
        </div>

        <div className="right-panel-actions">
          <button
            className={`icon-btn${activeTab?.panes.length === 2 ? ' active' : ''}`}
            title={activeTab?.panes.length === 2 ? '关闭终端分屏' : '左右分屏'}
            aria-label={activeTab?.panes.length === 2 ? '关闭终端分屏' : '左右分屏'}
            disabled={!activeTab}
            onClick={toggleSplit}
          >
            <Columns2 size={15} strokeWidth={1.8} />
          </button>
          <button
            className="icon-btn"
            title="关闭已退出或错误的终端"
            aria-label="关闭已退出或错误的终端"
            disabled={!tabs.some((tab) => ['exited', 'error'].includes(aggregateStatus(tab.panes)))}
            onClick={closeInactiveSessions}
          >
            <Trash2 size={15} strokeWidth={1.8} />
          </button>
          <button
            className={`icon-btn${pickerOpen ? ' active' : ''}`}
            title="新建 Agent 终端"
            aria-label="新建 Agent 终端"
            onClick={() => setPickerOpen((open) => !open)}
          >
            <Plus size={15} strokeWidth={2} />
          </button>
          <button
            className="icon-btn"
            title="收起右侧栏 (⌘⌥B)"
            aria-label="收起右侧栏"
            onClick={onCollapse}
          >
            <PanelRightClose size={15} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {pickerOpen && <AgentPicker onChoose={openTerminal} />}

      <div className="tab-body">
        {!activeId && <PanelChooser onChoose={openTerminal} message={message} />}
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`right-tab-content terminal-layout${tab.panes.length === 2 ? ' split' : ''}`}
            style={{ display: activeId === tab.id ? 'flex' : 'none' }}
          >
            {project ? (
              tab.panes.map((pane, index) => (
                <div
                  className={`terminal-pane${activePaneId === pane.id ? ' active' : ''}`}
                  key={pane.id}
                  onMouseDown={() => setActivePaneId(pane.id)}
                >
                  {tab.panes.length === 2 && (
                    <div className="terminal-pane-head">
                      <span>{index === 0 ? '左侧' : '右侧'}</span>
                      <span className={`terminal-status ${pane.status}`}>
                        <i />
                        {STATUS_LABEL[pane.status]}
                      </span>
                      <button
                        className="icon-btn terminal-pane-close"
                        title="关闭此终端窗格"
                        aria-label="关闭此终端窗格"
                        onClick={() => closePane(tab.id, pane.id)}
                      >
                        <X size={12} strokeWidth={2} />
                      </button>
                    </div>
                  )}
                  <TerminalView
                    ref={(handle) => {
                      if (handle) terminalRefs.current.set(pane.id, handle)
                      else terminalRefs.current.delete(pane.id)
                    }}
                    terminalId={pane.id}
                    agent={tab.agent}
                    projectKey={project.root}
                    active={activeId === tab.id && activePaneId === pane.id}
                    fontSize={settings.terminal.fontSize}
                    scrollback={settings.terminal.scrollback}
                    onFocus={() => setActivePaneId(pane.id)}
                    onStatusChange={(status) => updatePaneStatus(tab.id, pane.id, status)}
                  />
                </div>
              ))
            ) : (
              <div className="placeholder">
                <div className="sub">请先打开项目文件夹。</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
})

function AgentPicker({ onChoose }: { onChoose: (agent: PtyAgent) => void }): JSX.Element {
  return (
    <div className="right-picker">
      <AgentChoice agent="claude" compact onChoose={onChoose} />
      <AgentChoice agent="codex" compact onChoose={onChoose} />
    </div>
  )
}

function PanelChooser({
  onChoose,
  message
}: {
  onChoose: (agent: PtyAgent) => void
  message: string | null
}): JSX.Element {
  return (
    <div className="panel-chooser">
      <div className="panel-chooser-title">选择 Agent</div>
      <AgentChoice agent="claude" onChoose={onChoose} />
      <AgentChoice agent="codex" onChoose={onChoose} />
      <p className="panel-chooser-note">点击后直接以 bypass 模式进入项目终端。</p>
      {message && <p className="panel-chooser-message">{message}</p>}
    </div>
  )
}

function AgentChoice({
  agent,
  compact = false,
  onChoose
}: {
  agent: PtyAgent
  compact?: boolean
  onChoose: (agent: PtyAgent) => void
}): JSX.Element {
  const isClaude = agent === 'claude'
  const Icon = isClaude ? Bot : Code2
  return (
    <button onClick={() => onChoose(agent)}>
      {!compact && (
        <span className="panel-choice-icon">
          <Icon size={17} strokeWidth={1.7} />
        </span>
      )}
      {compact && <Icon size={15} strokeWidth={1.8} />}
      <span>
        <strong>{isClaude ? 'Claude' : 'Codex'}</strong>
        <small>{isClaude ? '直接进入 Claude bypass 模式' : '直接进入 Codex bypass 模式'}</small>
      </span>
    </button>
  )
}

function aggregateStatus(panes: TerminalPane[]): TerminalTaskStatus {
  if (panes.some((pane) => pane.status === 'active')) return 'active'
  if (panes.some((pane) => pane.status === 'starting')) return 'starting'
  if (panes.some((pane) => pane.status === 'error')) return 'error'
  if (panes.some((pane) => pane.status === 'exited')) return 'exited'
  return 'idle'
}

function toSessionInfo(tab: TerminalTab, activeId: string | null): TerminalSessionInfo {
  return {
    id: tab.id,
    agent: tab.agent,
    label: tab.label,
    status: aggregateStatus(tab.panes),
    paneCount: tab.panes.length,
    active: tab.id === activeId,
    closed: false,
    updatedAt: Date.now()
  }
}

function toClosedPaneSession(
  tab: TerminalTab,
  paneId: string,
  paneIndex: number
): TerminalSessionInfo {
  return {
    id: paneId,
    agent: tab.agent,
    label: `${tab.label} ${paneIndex >= 0 ? paneIndex + 1 : ''}`.trim(),
    status: 'closed',
    paneCount: 1,
    active: false,
    closed: true,
    updatedAt: Date.now()
  }
}

function loadSessionHistory(): TerminalSessionInfo[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_HISTORY_KEY) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(isTerminalSessionInfo)
      .slice(0, SESSION_HISTORY_LIMIT)
  } catch {
    return []
  }
}

function isTerminalSessionInfo(value: unknown): value is TerminalSessionInfo {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<TerminalSessionInfo>
  return (
    typeof item.id === 'string' &&
    (item.agent === 'claude' || item.agent === 'codex') &&
    typeof item.label === 'string' &&
    typeof item.updatedAt === 'number'
  )
}
