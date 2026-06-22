import { useEffect, useRef, useState } from 'react'
import {
  Bell,
  BellOff,
  Bot,
  Code2,
  Columns2,
  PanelRightClose,
  Plus,
  X
} from 'lucide-react'
import type { ProjectInfo, PtyAgent } from '../../shared/types'
import { TerminalView, type TerminalTaskStatus } from './TerminalView'

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
  onCollapse: () => void
}

const STATUS_LABEL: Record<TerminalTaskStatus, string> = {
  idle: '无任务',
  running: '执行中',
  completed: '执行结束'
}

export function RightPanel({ project, onCollapse }: RightPanelProps): JSX.Element {
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [muted, setMuted] = useState(() => localStorage.getItem('studio.terminalMuted') === '1')
  const terminalNumber = useRef(0)

  useEffect(() => {
    localStorage.setItem('studio.terminalMuted', muted ? '1' : '0')
  }, [muted])

  const openTerminal = (agent: PtyAgent): string => {
    terminalNumber.current += 1
    const number = terminalNumber.current
    const id = `${agent}-${number}`
    const tab: TerminalTab = {
      id,
      agent,
      label: `${agent === 'claude' ? 'Claude' : 'Codex'} ${number}`,
      panes: [{ id: `${id}-pane-1`, status: 'idle' }]
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
          panes: [...tab.panes, { id: `${tab.id}-pane-2`, status: 'idle' }]
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
                  title="关闭标签"
                  onClick={(event) => {
                    event.stopPropagation()
                    closeTab(tab.id)
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
            className={`icon-btn${muted ? '' : ' active'}`}
            title={muted ? '开启任务完成响铃' : '静音任务完成响铃'}
            onClick={() => setMuted((value) => !value)}
          >
            {muted ? <BellOff size={14} strokeWidth={1.8} /> : <Bell size={14} strokeWidth={1.8} />}
          </button>
          <button
            className={`icon-btn${activeTab?.panes.length === 2 ? ' active' : ''}`}
            title={activeTab?.panes.length === 2 ? '关闭终端分屏' : '左右分屏'}
            disabled={!activeTab}
            onClick={toggleSplit}
          >
            <Columns2 size={15} strokeWidth={1.8} />
          </button>
          <button
            className={`icon-btn${pickerOpen ? ' active' : ''}`}
            title="新建 Agent 终端"
            onClick={() => setPickerOpen((open) => !open)}
          >
            <Plus size={15} strokeWidth={2} />
          </button>
          <button className="icon-btn" title="收起右侧栏 (⌘⌥B)" onClick={onCollapse}>
            <PanelRightClose size={15} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {pickerOpen && <AgentPicker onChoose={openTerminal} />}

      <div className="tab-body">
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
                    onStatusChange={(status) => updatePaneStatus(tab.id, pane.id, status)}
                    onTaskComplete={() => {
                      if (!muted) playCompletionBell()
                    }}
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
  if (panes.some((pane) => pane.status === 'running')) return 'running'
  if (panes.some((pane) => pane.status === 'completed')) return 'completed'
  return 'idle'
}

function playCompletionBell(): void {
  const AudioContextClass = window.AudioContext
  const context = new AudioContextClass()
  const gain = context.createGain()
  gain.gain.setValueAtTime(0.0001, context.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.32)
  gain.connect(context.destination)

  for (const [frequency, delay] of [
    [660, 0],
    [880, 0.11]
  ] as const) {
    const oscillator = context.createOscillator()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    oscillator.connect(gain)
    oscillator.start(context.currentTime + delay)
    oscillator.stop(context.currentTime + delay + 0.2)
  }

  window.setTimeout(() => void context.close(), 500)
}
