import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bell,
  Bot,
  CheckCircle2,
  CircleAlert,
  History,
  Keyboard,
  Monitor,
  Play,
  RotateCcw,
  Settings2,
  TerminalSquare,
  X
} from 'lucide-react'
import type {
  AgentAvailability,
  AgentProvider,
  Settings,
  SettingsPatch,
  TerminalSessionInfo
} from '../../shared/types'
import { RECOMMENDED_HOTKEYS } from '../../shared/hotkeyPresets'

type SettingsSection =
  | 'general'
  | 'ai'
  | 'notifications'
  | 'terminal'
  | 'hotkeys'
  | 'sessions'
  | 'appearance'

interface SettingsPanelProps {
  open: boolean
  settings: Settings
  availability: AgentAvailability[]
  terminalSessions: TerminalSessionInfo[]
  loading: boolean
  error: string | null
  onChange: (patch: SettingsPatch) => void
  onReset: () => void
  onLoadTerminalSession: (sessionId: string) => void
  onClose: () => void
}

const SECTIONS: Array<{
  id: SettingsSection
  label: string
  icon: typeof Settings2
}> = [
  { id: 'general', label: '通用', icon: Settings2 },
  { id: 'ai', label: 'AI', icon: Bot },
  { id: 'notifications', label: '通知', icon: Bell },
  { id: 'terminal', label: '终端', icon: TerminalSquare },
  { id: 'hotkeys', label: '热键', icon: Keyboard },
  { id: 'sessions', label: '会话', icon: History },
  { id: 'appearance', label: '外观', icon: Monitor }
]

const HOTKEY_ACTION_LABELS = {
  'focus-claude-terminal': '打开/聚焦 Claude 终端',
  'focus-codex-terminal': '打开/聚焦 Codex 终端',
  'paste-preset-text': '粘贴预设文本'
} as const

const SESSION_STATUS_LABELS: Record<TerminalSessionInfo['status'], string> = {
  starting: '启动中',
  idle: '空闲',
  active: '活跃',
  exited: '已退出',
  error: '错误',
  closed: '已关闭'
}

export function SettingsPanel({
  open,
  settings,
  availability,
  terminalSessions,
  loading,
  error,
  onChange,
  onReset,
  onLoadTerminalSession,
  onClose
}: SettingsPanelProps): JSX.Element | null {
  const [section, setSection] = useState<SettingsSection>('general')
  const [recordingHotkey, setRecordingHotkey] = useState<number | null>(null)
  const [recordingMessage, setRecordingMessage] = useState('按下组合键')
  const dialogRef = useRef<HTMLElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const recordingHotkeyRef = useRef<number | null>(null)

  useEffect(() => {
    recordingHotkeyRef.current = recordingHotkey
  }, [recordingHotkey])

  const updateHotkey = useCallback((
    index: number,
    patch: NonNullable<SettingsPatch['hotkeys']>[number]
  ): void => {
    const hotkeys = Array.from({ length: settings.hotkeys.length }, (_, itemIndex) =>
      itemIndex === index ? patch : null
    )
    onChange({ hotkeys })
  }, [onChange, settings.hotkeys.length])

  useEffect(() => {
    if (!open) return
    previousFocus.current = document.activeElement as HTMLElement | null

    const onKeyDown = (event: KeyboardEvent): void => {
      const activeRecording = recordingHotkeyRef.current
      if (activeRecording !== null) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        if (event.key === 'Escape') {
          setRecordingHotkey(null)
          return
        }
        if (event.key === 'Backspace' || event.key === 'Delete') {
          updateHotkey(activeRecording, { accelerator: '', enabled: false })
          setRecordingHotkey(null)
          return
        }
        if (isModifierKey(event.key)) {
          setRecordingMessage(formatPressedModifiers(event))
          return
        }
        const accelerator = formatAccelerator(event)
        if (!accelerator) {
          setRecordingMessage('需要包含 Command / Control / Option / Shift')
          return
        }
        updateHotkey(activeRecording, { accelerator, enabled: true })
        setRecordingHotkey(null)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
      )]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      previousFocus.current?.focus()
    }
  }, [open, onClose, updateHotkey])

  const startRecordingHotkey = (index: number): void => {
    setRecordingHotkey(index)
    setRecordingMessage('按下组合键')
  }

  if (!open) return null

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="settings-sheet settings-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-head">
          <div>
            <strong id="settings-title">Studio 设置</strong>
            <span>AI、通知、终端、热键和工作区外观</span>
          </div>
          <button
            ref={closeRef}
            className="icon-btn"
            aria-label="关闭设置"
            title="关闭设置"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </header>

        <div className="settings-main">
          <nav className="settings-nav" aria-label="设置分类">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={section === id ? 'active' : ''}
                aria-current={section === id ? 'page' : undefined}
                onClick={() => setSection(id)}
              >
                <Icon size={15} strokeWidth={1.8} />
                {label}
              </button>
            ))}
          </nav>

          <div className="settings-content settings-page">
            {loading ? (
              <div className="settings-state">正在读取设置…</div>
            ) : (
              <>
                {section === 'general' && (
                  <SettingsGroup title="启动与确认">
                    <ToggleRow
                      label="恢复上次项目"
                      detail="下次启动时重新打开最近使用的项目。"
                      checked={settings.general.restoreLastProject}
                      onChange={(restoreLastProject) =>
                        onChange({ general: { restoreLastProject } })
                      }
                    />
                    <ToggleRow
                      label="放弃 AI 修改前确认"
                      detail="存在未应用的文件修改时显示确认提示。"
                      checked={settings.general.confirmBeforeDiscard}
                      onChange={(confirmBeforeDiscard) =>
                        onChange({ general: { confirmBeforeDiscard } })
                      }
                    />
                  </SettingsGroup>
                )}

                {section === 'ai' && (
                  <>
                    <SettingsGroup title="默认 Agent">
                      <div className="agent-setting-grid">
                        {(['claude', 'codex'] as AgentProvider[]).map((provider) => {
                          const state = availability.find((item) => item.provider === provider)
                          return (
                            <button
                              key={provider}
                              className={`agent-setting-card${
                                settings.ai.defaultProvider === provider ? ' selected' : ''
                              }`}
                              disabled={state?.available === false}
                              onClick={() =>
                                onChange({ ai: { defaultProvider: provider } })
                              }
                            >
                              <span>
                                <strong>{provider === 'claude' ? 'Claude' : 'Codex'}</strong>
                                <small>{state?.version ?? (state ? '未安装' : '检测中…')}</small>
                              </span>
                              {state?.available ? (
                                <CheckCircle2 size={15} />
                              ) : (
                                <CircleAlert size={15} />
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </SettingsGroup>
                    <SettingsGroup title="任务工作台">
                      <ToggleRow
                        label="启用任务工作台"
                        detail="在右侧栏提供结构化 AI 任务（隔离工作区、diff 审阅、选择性应用）。关闭后右侧栏只保留交互式终端。"
                        checked={settings.ai.tasksEnabled}
                        onChange={(tasksEnabled) => onChange({ ai: { tasksEnabled } })}
                      />
                    </SettingsGroup>
                    <SettingsGroup title="执行方式">
                      <label className="setting-text-row">
                        <span>
                          <strong>Claude 模型</strong>
                          <small>留空时继承 Claude CLI 配置。</small>
                        </span>
                        <input
                          value={settings.ai.claudeModel}
                          placeholder="默认"
                          onChange={(event) =>
                            onChange({ ai: { claudeModel: event.currentTarget.value } })
                          }
                        />
                      </label>
                      <label className="setting-text-row">
                        <span>
                          <strong>Codex 模型</strong>
                          <small>留空时继承 Codex CLI 配置。</small>
                        </span>
                        <input
                          value={settings.ai.codexModel}
                          placeholder="默认"
                          onChange={(event) =>
                            onChange({ ai: { codexModel: event.currentTarget.value } })
                          }
                        />
                      </label>
                      <ToggleRow
                        label="默认使用 bypass"
                        detail="临时副本便于审阅修改，但 bypass 不限制 Agent 的系统访问能力。"
                        checked={settings.ai.bypassPermissions}
                        warning
                        onChange={(bypassPermissions) =>
                          onChange({ ai: { bypassPermissions } })
                        }
                      />
                      <SliderRow
                        label="任务超时"
                        value={settings.ai.taskTimeoutMs / 60_000}
                        min={1}
                        max={60}
                        step={1}
                        suffix=" 分钟"
                        onChange={(minutes) =>
                          onChange({ ai: { taskTimeoutMs: minutes * 60_000 } })
                        }
                      />
                    </SettingsGroup>
                  </>
                )}

                {section === 'notifications' && (
                  <SettingsGroup title="任务通知">
                    <ToggleRow
                      label="任务完成时通知"
                      detail="结构化 AI 任务完成后显示通知状态。"
                      checked={settings.notifications.notifyOnTaskComplete}
                      onChange={(notifyOnTaskComplete) =>
                        onChange({ notifications: { notifyOnTaskComplete } })
                      }
                    />
                    <ToggleRow
                      label="任务失败时通知"
                      detail="任务异常退出或超时时显示通知状态。"
                      checked={settings.notifications.notifyOnTaskError}
                      onChange={(notifyOnTaskError) =>
                        onChange({ notifications: { notifyOnTaskError } })
                      }
                    />
                    <ToggleRow
                      label="播放完成声音"
                      detail="仅对结构化 AI 任务生效。"
                      checked={settings.notifications.soundEnabled}
                      onChange={(soundEnabled) =>
                        onChange({ notifications: { soundEnabled } })
                      }
                    />
                  </SettingsGroup>
                )}

                {section === 'terminal' && (
                  <>
                  <SettingsGroup title="终端行为">
                    <ToggleRow
                      label="自动粘贴路径"
                      detail="复制相对路径时，同时把“（相对路径）”写入当前活跃终端。"
                      checked={settings.terminal.autoPastePath}
                      onChange={(autoPastePath) =>
                        onChange({ terminal: { autoPastePath } })
                      }
                    />
                  </SettingsGroup>
                  <SettingsGroup title="终端显示">
                    <SliderRow
                      label="字体大小"
                      value={settings.terminal.fontSize}
                      min={9}
                      max={24}
                      step={1}
                      suffix=" px"
                      onChange={(fontSize) => onChange({ terminal: { fontSize } })}
                    />
                    <SliderRow
                      label="行距"
                      value={settings.terminal.lineHeight}
                      min={1}
                      max={2}
                      step={0.05}
                      suffix=" 倍"
                      onChange={(lineHeight) => onChange({ terminal: { lineHeight } })}
                    />
                    <SliderRow
                      label="字距"
                      value={settings.terminal.letterSpacing}
                      min={0}
                      max={3}
                      step={0.5}
                      suffix=" px"
                      onChange={(letterSpacing) => onChange({ terminal: { letterSpacing } })}
                    />
                    <label className="setting-text-row">
                      <span>
                        <strong>字体</strong>
                        <small>留空使用内置等宽字体（SF Mono / Menlo）。</small>
                      </span>
                      <input
                        value={settings.terminal.fontFamily}
                        placeholder="默认"
                        onChange={(event) =>
                          onChange({ terminal: { fontFamily: event.currentTarget.value } })
                        }
                      />
                    </label>
                    <SliderRow
                      label="回滚行数"
                      value={settings.terminal.scrollback}
                      min={500}
                      max={20_000}
                      step={500}
                      suffix=" 行"
                      onChange={(scrollback) => onChange({ terminal: { scrollback } })}
                    />
                  </SettingsGroup>
                  </>
                )}

                {section === 'hotkeys' && (
                  <SettingsGroup title="自定义热键">
                    <div className="hotkey-help">
                      <span>
                        点击录制后直接按组合键，保存后会自动启用；按 Delete 清空，按 Esc 取消。
                      </span>
                      <button
                        className="text-btn"
                        type="button"
                        onClick={() => onChange({ hotkeys: RECOMMENDED_HOTKEYS })}
                      >
                        应用推荐热键
                      </button>
                    </div>
                    {settings.hotkeys.map((hotkey, index) => (
                      <div className="hotkey-row" key={hotkey.id}>
                        <label className="hotkey-enable">
                          <input
                            type="checkbox"
                            checked={hotkey.enabled}
                            onChange={(event) =>
                              updateHotkey(index, { enabled: event.currentTarget.checked })
                            }
                          />
                          <span>热键 {index + 1}</span>
                        </label>
                        <button
                          type="button"
                          className={`hotkey-recorder${
                            recordingHotkey === index ? ' recording' : ''
                          }`}
                          title="点击后按下新的组合键"
                          onClick={(event) => {
                            event.currentTarget.focus()
                            startRecordingHotkey(index)
                          }}
                        >
                          <span>
                            {recordingHotkey === index
                              ? recordingMessage
                              : hotkey.accelerator || '未设置'}
                          </span>
                          <small>{recordingHotkey === index ? '录制中' : '点击录制'}</small>
                          {recordingHotkey !== index && hotkey.accelerator && !hotkey.enabled && (
                            <em>未启用</em>
                          )}
                        </button>
                        <select
                          value={hotkey.action}
                          onChange={(event) =>
                            updateHotkey(index, {
                              action: event.currentTarget.value as Settings['hotkeys'][number]['action']
                            })
                          }
                        >
                          {Object.entries(HOTKEY_ACTION_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                        {hotkey.action === 'paste-preset-text' && (
                          <input
                            className="hotkey-preset"
                            value={hotkey.presetText}
                            placeholder="要粘贴到当前终端的预设文本"
                            onChange={(event) =>
                              updateHotkey(index, { presetText: event.currentTarget.value })
                            }
                          />
                        )}
                      </div>
                    ))}
                  </SettingsGroup>
                )}

                {section === 'sessions' && (
                  <SettingsGroup title="终端会话">
                    {terminalSessions.length === 0 ? (
                      <div className="session-empty">还没有可载入的终端会话。</div>
                    ) : (
                      <div className="session-list">
                        {terminalSessions.map((session) => (
                          <div className="session-row" key={session.id}>
                            <span className={`session-agent ${session.agent}`}>
                              {session.agent === 'claude' ? 'Claude' : 'Codex'}
                            </span>
                            <span className="session-main">
                              <strong>{session.label}</strong>
                              <small>
                                {session.closed ? '历史' : session.active ? '当前' : '打开'} ·{' '}
                                {SESSION_STATUS_LABELS[session.status]} · {session.paneCount} 个窗格
                              </small>
                            </span>
                            <button
                              className="text-btn"
                              onClick={() => onLoadTerminalSession(session.id)}
                            >
                              <Play size={13} />
                              {session.closed ? '载入' : '切换'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </SettingsGroup>
                )}

                {section === 'appearance' && (
                  <>
                    <SettingsGroup title="主题">
                      <label className="setting-select-row">
                        <span>颜色主题</span>
                        <select
                          value={settings.appearance.colorScheme}
                          onChange={(event) =>
                            onChange({
                              appearance: {
                                colorScheme: event.currentTarget.value as Settings['appearance']['colorScheme']
                              }
                            })
                          }
                        >
                          <option value="system">跟随系统</option>
                          <option value="light">浅色</option>
                          <option value="dark">深色（预览）</option>
                        </select>
                      </label>
                    </SettingsGroup>
                    <SettingsGroup title="侧栏">
                      <SliderRow
                        label="透明度"
                        value={settings.appearance.panelOpacity}
                        min={0.35}
                        max={0.96}
                        step={0.01}
                        suffix="%"
                        onChange={(panelOpacity) =>
                          onChange({ appearance: { panelOpacity } })
                        }
                      />
                      <SliderRow
                        label="背景模糊"
                        value={settings.appearance.blur}
                        min={0}
                        max={72}
                        step={1}
                        suffix=" px"
                        onChange={(blur) => onChange({ appearance: { blur } })}
                      />
                      <SliderRow
                        label="过渡动画"
                        value={settings.appearance.animationMs}
                        min={80}
                        max={360}
                        step={10}
                        suffix=" ms"
                        onChange={(animationMs) =>
                          onChange({ appearance: { animationMs } })
                        }
                      />
                      <SliderRow
                        label="文件栏宽度"
                        value={settings.layout.leftWidth}
                        min={0}
                        max={1200}
                        step={4}
                        suffix=" px"
                        onChange={(leftWidth) => onChange({ layout: { leftWidth } })}
                      />
                      <SliderRow
                        label="右侧栏宽度"
                        value={settings.layout.rightWidth}
                        min={0}
                        max={1200}
                        step={4}
                        suffix=" px"
                        onChange={(rightWidth) => onChange({ layout: { rightWidth } })}
                      />
                    </SettingsGroup>
                    <SettingsGroup title="关于">
                      <div className="about-row">
                        <span className="about-badge">Built &amp; reviewed with Claude Fable 5</span>
                        <small>
                          本项目由 Claude Fable 5（Anthropic）协助开发与审查。此为项目自述标注，非
                          Anthropic 官方认证。
                        </small>
                      </div>
                    </SettingsGroup>
                  </>
                )}
              </>
            )}
            {error && <div className="settings-error">{error}</div>}
          </div>
        </div>

        <footer className="settings-foot">
          <button className="text-btn" onClick={onReset}>
            <RotateCcw size={14} />
            恢复全部默认值
          </button>
        </footer>
      </section>
    </div>
  )
}

function isModifierKey(key: string): boolean {
  return key === 'Meta' || key === 'Control' || key === 'Alt' || key === 'Shift'
}

type HotkeyEventLike = Pick<
  KeyboardEvent,
  'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'
>

function formatPressedModifiers(event: HotkeyEventLike): string {
  const parts: string[] = []
  if (event.metaKey || event.ctrlKey) parts.push('CmdOrCtrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  return parts.length ? `${parts.join('+')}+…` : '按下组合键'
}

function formatAccelerator(event: HotkeyEventLike): string | null {
  const key = normalizeAcceleratorKey(event)
  if (!key) return null
  const parts: string[] = []
  if (event.metaKey || event.ctrlKey) parts.push('CmdOrCtrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (!parts.length) return null
  parts.push(key)
  return parts.join('+')
}

function normalizeAcceleratorKey(event: HotkeyEventLike): string | null {
  const { key, code } = event
  if (isModifierKey(key)) return null
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^Numpad\d$/.test(code)) return `Num${code.slice(6)}`
  const codeAliases: Record<string, string> = {
    Space: 'Space',
    Minus: 'Minus',
    Equal: 'Equal',
    BracketLeft: 'BracketLeft',
    BracketRight: 'BracketRight',
    Backslash: 'Backslash',
    Semicolon: 'Semicolon',
    Quote: 'Quote',
    Comma: 'Comma',
    Period: 'Period',
    Slash: 'Slash',
    Backquote: 'Backquote'
  }
  if (codeAliases[code]) return codeAliases[code]
  if (key === ' ') return 'Space'
  if (key === '+') return 'Plus'
  if (key.length === 1) return key.toUpperCase()
  const aliases: Record<string, string> = {
    Escape: 'Esc',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right'
  }
  if (aliases[key]) return aliases[key]
  if (/^F\d{1,2}$/.test(key)) return key
  if (/^(Tab|Enter|Home|End|PageUp|PageDown)$/.test(key)) return key
  return key.length > 1 ? key : null
}

function SettingsGroup({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className="settings-group">
      <h3>{title}</h3>
      <div>{children}</div>
    </section>
  )
}

function ToggleRow({
  label,
  detail,
  checked,
  warning = false,
  onChange
}: {
  label: string
  detail: string
  checked: boolean
  warning?: boolean
  onChange: (value: boolean) => void
}): JSX.Element {
  return (
    <label className={`setting-toggle-row${warning ? ' warning' : ''}`}>
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </label>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix: string
  onChange: (value: number) => void
}): JSX.Element {
  return (
    <label className="setting-row">
      <span className="setting-label">
        <span>{label}</span>
        <output>
          {suffix === '%'
            ? Math.round(value * 100)
            : Number.isInteger(step)
              ? Math.round(value)
              : Number(value.toFixed(2))}
          {suffix}
        </output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  )
}
