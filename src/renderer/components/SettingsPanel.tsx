import { useEffect, useRef, useState } from 'react'
import {
  Bell,
  Bot,
  CheckCircle2,
  CircleAlert,
  Monitor,
  RotateCcw,
  Settings2,
  TerminalSquare,
  X
} from 'lucide-react'
import type {
  AgentAvailability,
  AgentProvider,
  Settings,
  SettingsPatch
} from '../../shared/types'

type SettingsSection = 'general' | 'ai' | 'notifications' | 'terminal' | 'appearance'

interface SettingsPanelProps {
  open: boolean
  settings: Settings
  availability: AgentAvailability[]
  loading: boolean
  error: string | null
  onChange: (patch: SettingsPatch) => void
  onReset: () => void
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
  { id: 'appearance', label: '外观', icon: Monitor }
]

export function SettingsPanel({
  open,
  settings,
  availability,
  loading,
  error,
  onChange,
  onReset,
  onClose
}: SettingsPanelProps): JSX.Element | null {
  const [section, setSection] = useState<SettingsSection>('general')
  const dialogRef = useRef<HTMLElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    previousFocus.current = document.activeElement as HTMLElement | null
    requestAnimationFrame(() => closeRef.current?.focus())

    const onKeyDown = (event: KeyboardEvent): void => {
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
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      previousFocus.current?.focus()
    }
  }, [open, onClose])

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
            <span>AI、通知、终端和工作区外观</span>
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
                      <SliderRow
                        label="Claude 单任务预算"
                        value={settings.ai.maxBudgetUsd}
                        min={0}
                        max={20}
                        step={0.5}
                        suffix=" USD"
                        onChange={(maxBudgetUsd) => onChange({ ai: { maxBudgetUsd } })}
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
                      label="回滚行数"
                      value={settings.terminal.scrollback}
                      min={500}
                      max={20_000}
                      step={500}
                      suffix=" 行"
                      onChange={(scrollback) => onChange({ terminal: { scrollback } })}
                    />
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
                        min={200}
                        max={460}
                        step={4}
                        suffix=" px"
                        onChange={(leftWidth) => onChange({ layout: { leftWidth } })}
                      />
                      <SliderRow
                        label="右侧栏宽度"
                        value={settings.layout.rightWidth}
                        min={240}
                        max={520}
                        step={4}
                        suffix=" px"
                        onChange={(rightWidth) => onChange({ layout: { rightWidth } })}
                      />
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
          {suffix === '%' ? Math.round(value * 100) : Math.round(value)}
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
