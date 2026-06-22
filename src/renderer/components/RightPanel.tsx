import { useEffect, useRef, useState } from 'react'
import {
  Bot,
  Code2,
  Columns2,
  ListTodo,
  PanelRightClose,
  Plus,
  TerminalSquare,
  X
} from 'lucide-react'
import type {
  AgentAvailability,
  ProjectInfo,
  PtyAgent,
  Settings
} from '../../shared/types'
import { TerminalView, type TerminalTaskStatus } from './TerminalView'
import { TaskWorkspace } from './TaskWorkspace'

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

interface RightPanelProps {
  project: ProjectInfo | null
  selectedPath: string | null
  settings: Settings
  availability: AgentAvailability[]
  onCollapse: () => void
}

const STATUS_LABEL: Record<TerminalTaskStatus, string> = {
  starting: '启动中',
  idle: '空闲',
  active: '活跃',
  exited: '已退出',
  error: '错误'
}

export function RightPanel({
  project,
  selectedPath,
  settings,
  availability,
  onCollapse
}: RightPanelProps): JSX.Element {
  const [mode, setMode] = useState<'tasks' | 'terminal'>('tasks')
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const terminalNumber = useRef(0)

  useEffect(() => {
    setTabs([])
    setActiveId(null)
    setPickerOpen(false)
    setRenamingId(null)
    terminalNumber.current = 0
  }, [project?.root])

  const openTerminal = (agent: PtyAgent): string => {
    terminalNumber.current += 1
    const number = terminalNumber.current
    const id = `${agent}-${number}`
    const tab: TerminalTab = {
      id,
      agent,
      label: `${agent === 'claude' ? 'Claude' : 'Codex'} ${number}`,
      panes: [{ id: `${id}-pane-1`, status: 'starting' }]
    }
    setTabs((current) => [...current, tab])
    setActiveId(id)
    setPickerOpen(false)
    return id
  }

  const closeTab = (id: string): void => {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.id === id)
      const next = current.filter((tab) => tab.id !== id)
      if (activeId === id) setActiveId(next[Math.min(index, next.length - 1)]?.id ?? null)
      return next
    })
    if (renamingId === id) setRenamingId(null)
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
        if (tab.panes.length > 1) return { ...tab, panes: [tab.panes[0]] }
        return {
          ...tab,
          panes: [...tab.panes, { id: `${tab.id}-pane-2`, status: 'starting' }]
        }
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
        current.map((tab) => (tab.id === renamingId ? { ...tab, label } : tab))
      )
    }
    setRenamingId(null)
  }

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? null

  return (
    <>
      <div className="right-panel-head">
        <div className="right-mode-switch" role="tablist" aria-label="右侧栏模式">
          <button
            role="tab"
            aria-selected={mode === 'tasks'}
            className={mode === 'tasks' ? 'active' : ''}
            onClick={() => setMode('tasks')}
          >
            <ListTodo size={13} />
            任务
          </button>
          <button
            role="tab"
            aria-selected={mode === 'terminal'}
            className={mode === 'terminal' ? 'active' : ''}
            onClick={() => setMode('terminal')}
          >
            <TerminalSquare size={13} />
            终端
          </button>
        </div>
        <div className="right-tabs" style={{ display: mode === 'terminal' ? 'flex' : 'none' }}>
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
                onClick={() => setActiveId(tab.id)}
                onDoubleClick={() => startRename(tab)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') setActiveId(tab.id)
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
            disabled={mode !== 'terminal' || !activeTab}
            onClick={toggleSplit}
          >
            <Columns2 size={15} strokeWidth={1.8} />
          </button>
          <button
            className={`icon-btn${pickerOpen ? ' active' : ''}`}
            title="新建 Agent 终端"
            aria-label="新建 Agent 终端"
            disabled={mode !== 'terminal'}
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

      {pickerOpen && mode === 'terminal' && <AgentPicker onChoose={openTerminal} />}

      {mode === 'tasks' ? (
        <TaskWorkspace
          projectRoot={project?.root ?? null}
          selectedPath={selectedPath}
          settings={settings}
          availability={availability}
        />
      ) : <div className="tab-body">
        {!activeId && <PanelChooser onChoose={openTerminal} />}
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`right-tab-content terminal-layout${tab.panes.length === 2 ? ' split' : ''}`}
            style={{ display: activeId === tab.id ? 'flex' : 'none' }}
          >
            {project ? (
              tab.panes.map((pane, index) => (
                <div className="terminal-pane" key={pane.id}>
                  {tab.panes.length === 2 && (
                    <div className="terminal-pane-head">
                      <span>{index === 0 ? '左侧' : '右侧'}</span>
                      <span className={`terminal-status ${pane.status}`}>
                        <i />
                        {STATUS_LABEL[pane.status]}
                      </span>
                    </div>
                  )}
                  <TerminalView
                    terminalId={pane.id}
                    agent={tab.agent}
                    projectKey={project.root}
                    active={activeId === tab.id}
                    fontSize={settings.terminal.fontSize}
                    scrollback={settings.terminal.scrollback}
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
      </div>}
    </>
  )
}

function AgentPicker({ onChoose }: { onChoose: (agent: PtyAgent) => void }): JSX.Element {
  return (
    <div className="right-picker">
      <AgentChoice agent="claude" compact onChoose={onChoose} />
      <AgentChoice agent="codex" compact onChoose={onChoose} />
    </div>
  )
}

function PanelChooser({ onChoose }: { onChoose: (agent: PtyAgent) => void }): JSX.Element {
  return (
    <div className="panel-chooser">
      <div className="panel-chooser-title">选择 Agent</div>
      <AgentChoice agent="claude" onChoose={onChoose} />
      <AgentChoice agent="codex" onChoose={onChoose} />
      <p className="panel-chooser-note">点击后直接以 bypass 模式进入项目终端。</p>
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
