import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  FolderOpen,
  FileText,
  History,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  Square,
  Trash2,
  X
} from 'lucide-react'
import type {
  AgentAvailability,
  AgentContextEstimate,
  AgentProvider,
  AgentSkill,
  AgentTask,
  AgentTaskEvent,
  Settings
} from '../../shared/types'
import { api } from '../lib/api'
import { parseAgentOutput, type AgentOutputLine } from '../lib/agentOutput'

const QUICK_TASKS = [
  { label: '总结文档', prompt: '总结当前文档，列出核心结论、关键数据和待办事项。' },
  { label: '检查遗漏', prompt: '检查当前文档是否存在信息遗漏、前后矛盾或需要补充的内容。' },
  { label: '提取节点', prompt: '从当前文档提取时间节点、责任人、交付物和风险。' },
  { label: '优化表达', prompt: '在保持事实不变的前提下优化当前文档的结构与表达。' }
]

const TASK_STATUS: Record<AgentTask['status'], string> = {
  pending: '等待中',
  preparing: '准备隔离工作区',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已停止'
}

const CONTEXT_TOKEN_BUDGET = 24_000

interface TaskWorkspaceProps {
  projectRoot: string | null
  settings: Settings
  availability: AgentAvailability[]
  contextPaths: string[]
  onRemoveContextPath: (path: string) => void
  onOpenDocumentPath: (relativePath: string) => void
}

export function TaskWorkspace({
  projectRoot,
  settings,
  availability,
  contextPaths,
  onRemoveContextPath,
  onOpenDocumentPath
}: TaskWorkspaceProps): JSX.Element {
  const [provider, setProvider] = useState<AgentProvider>(settings.ai.defaultProvider)
  const [prompt, setPrompt] = useState('')
  const [task, setTask] = useState<AgentTask | null>(null)
  const [history, setHistory] = useState<AgentTask[]>([])
  const [output, setOutput] = useState<AgentOutputLine[]>([])
  const [selectedChanges, setSelectedChanges] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [skills, setSkills] = useState<AgentSkill[]>([])
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [skillSearch, setSkillSearch] = useState('')
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(() =>
    localStorage.getItem('studio.recentSkillId')
  )
  const [contextEstimate, setContextEstimate] = useState<AgentContextEstimate | null>(null)
  const [contextError, setContextError] = useState<string | null>(null)
  const outputCounter = useRef(0)
  const outputBuffer = useRef({ stdout: '', stderr: '' })
  const activeTaskId = useRef<string | null>(null)
  const outputRef = useRef<HTMLDivElement | null>(null)
  const outputPinned = useRef(true)

  useEffect(() => setProvider(settings.ai.defaultProvider), [settings.ai.defaultProvider])

  const refreshHistory = useCallback((): void => {
    void api
      .listAgentTasks()
      .then((tasks) => setHistory(tasks.sort((a, b) => b.createdAt - a.createdAt)))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    let cancelled = false
    setSkillsLoading(true)
    void api
      .listSkills()
      .then((items) => {
        if (cancelled) return
        setSkills(items)
        setSelectedSkillId((current) =>
          current && items.some((skill) => skill.id === current) ? current : null
        )
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : '读取 Skill 失败')
      })
      .finally(() => {
        if (!cancelled) setSkillsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectRoot])

  useEffect(() => {
    let cancelled = false
    if (!projectRoot || contextPaths.length === 0) {
      setContextEstimate(null)
      setContextError(null)
      return
    }
    void api
      .estimateContext(contextPaths)
      .then((estimate) => {
        if (!cancelled) {
          setContextEstimate(estimate)
          setContextError(null)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setContextEstimate(null)
          setContextError(error instanceof Error ? error.message : '上下文分析失败')
        }
      })
    return () => {
      cancelled = true
    }
  }, [contextPaths, projectRoot])

  useEffect(() => {
    activeTaskId.current = task?.taskId ?? null
  }, [task?.taskId])

  useEffect(() => {
    void api
      .listAgentTasks()
      .then((tasks) => {
        const sorted = tasks.sort((a, b) => b.createdAt - a.createdAt)
        setHistory(sorted)
        const latest = sorted[0]
        setTask(latest ?? null)
        setOutput([])
        outputCounter.current = 0
        outputBuffer.current = { stdout: '', stderr: '' }
        setSelectedChanges(new Set(latest?.changedFiles.map((file) => file.path) ?? []))
      })
      .catch(() => undefined)
  }, [projectRoot])

  // Keep the streaming output pinned to the bottom unless the user scrolled up.
  useEffect(() => {
    const host = outputRef.current
    if (host && outputPinned.current) host.scrollTop = host.scrollHeight
  }, [output])

  useEffect(() => {
    return api.onAgentEvent((event) => {
      if (event.taskId !== activeTaskId.current) return
      setTask((current) => {
        if (!current || current.taskId !== event.taskId) return current
        return applyTaskEvent(current, event)
      })
      if (event.kind === 'stdout' || event.kind === 'stderr') {
        const combined = `${outputBuffer.current[event.kind]}${event.data ?? ''}`
        const parts = combined.split(/\r?\n/)
        outputBuffer.current[event.kind] = parts.pop() ?? ''
        const complete = parts.join('\n')
        const lines = parseAgentOutput(
          complete,
          outputCounter.current,
          event.kind === 'stderr' ? 'error' : 'normal'
        )
        outputCounter.current += Math.max(lines.length, 1)
        if (lines.length) {
          setOutput((current) => appendUniqueOutput(current, lines))
        }
      }
      if (event.kind === 'changes') {
        setSelectedChanges(new Set((event.changedFiles ?? []).map((file) => file.path)))
      }
      if (event.kind === 'status' && isFinished(event.status)) {
        for (const kind of ['stdout', 'stderr'] as const) {
          if (!outputBuffer.current[kind].trim()) continue
          const lines = parseAgentOutput(
            outputBuffer.current[kind],
            outputCounter.current,
            kind === 'stderr' ? 'error' : 'normal'
          )
          outputCounter.current += Math.max(lines.length, 1)
          if (lines.length) {
            setOutput((current) => appendUniqueOutput(current, lines))
          }
          outputBuffer.current[kind] = ''
        }
        refreshHistory()
        void api.getAgentTask(event.taskId).then((latest) => {
          if (!latest) return
          setTask(latest)
          setSelectedChanges(new Set(latest.changedFiles.map((file) => file.path)))
          if (settings.notifications.soundEnabled && latest.status === 'completed') {
            playTaskBell()
          }
          const shouldNotify =
            (latest.status === 'completed' &&
              settings.notifications.notifyOnTaskComplete) ||
            (latest.status === 'failed' && settings.notifications.notifyOnTaskError)
          if (shouldNotify && 'Notification' in window) {
            new Notification(
              latest.status === 'completed' ? 'Studio 任务已完成' : 'Studio 任务失败',
              {
                body:
                  latest.status === 'completed'
                    ? `${latest.provider === 'claude' ? 'Claude' : 'Codex'} 已完成任务`
                    : latest.error ?? 'Agent 任务异常结束'
              }
            )
          }
        })
      }
    })
  }, [
    refreshHistory,
    settings.notifications.notifyOnTaskComplete,
    settings.notifications.notifyOnTaskError,
    settings.notifications.soundEnabled
  ])

  const providerState = availability.find((item) => item.provider === provider)
  const selectedSkill = skills.find((skill) => skill.id === selectedSkillId) ?? null
  const filteredSkills = skills.filter((skill) => {
    const query = skillSearch.trim().toLowerCase()
    return (
      !query ||
      skill.name.toLowerCase().includes(query) ||
      skill.description.toLowerCase().includes(query) ||
      skill.command.toLowerCase().includes(query)
    )
  })
  const contextOverBudget = (contextEstimate?.estimatedTokens ?? 0) > CONTEXT_TOKEN_BUDGET
  const taskBusy = task?.status === 'running' || task?.status === 'preparing'
  const canStart =
    !!projectRoot &&
    (prompt.trim().length > 0 || !!selectedSkill) &&
    providerState?.available !== false &&
    !contextOverBudget &&
    !contextError &&
    !taskBusy

  const chooseSkill = (skill: AgentSkill | null): void => {
    setSelectedSkillId(skill?.id ?? null)
    if (skill) {
      setProvider('claude')
      localStorage.setItem('studio.recentSkillId', skill.id)
    } else {
      localStorage.removeItem('studio.recentSkillId')
    }
  }

  const refreshSkills = async (): Promise<void> => {
    setSkillsLoading(true)
    try {
      const items = await api.refreshSkills()
      setSkills(items)
      setSelectedSkillId((current) =>
        current && items.some((skill) => skill.id === current) ? current : null
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '刷新 Skill 失败')
    } finally {
      setSkillsLoading(false)
    }
  }

  const startTask = async (): Promise<void> => {
    if (!canStart) return
    setBusy(true)
    setMessage(null)
    setOutput([])
    outputCounter.current = 0
    outputBuffer.current = { stdout: '', stderr: '' }
    outputPinned.current = true
    const taskId = window.crypto.randomUUID()
    const skillRef = selectedSkill
      ? {
          id: selectedSkill.id,
          command: selectedSkill.command,
          source: selectedSkill.source,
          name: selectedSkill.name
        }
      : undefined
    const provisional: AgentTask = {
      taskId,
      provider,
      prompt: prompt.trim(),
      status: 'pending',
      createdAt: Date.now(),
      skill: skillRef,
      context: {
        paths: contextEstimate?.items.map((item) => item.relativePath) ?? [],
        estimatedTokens: contextEstimate?.estimatedTokens ?? 0
      },
      changedFiles: []
    }
    activeTaskId.current = taskId
    setTask(provisional)
    try {
      if (
        settings.notifications.notifyOnTaskComplete ||
        settings.notifications.notifyOnTaskError
      ) {
        if ('Notification' in window && Notification.permission === 'default') {
          await Notification.requestPermission()
        }
      }
      const started = await api.startAgentTask({
        taskId,
        provider,
        prompt: prompt.trim(),
        skill: skillRef,
        context: {
          paths: contextPaths,
          estimatedTokens: contextEstimate?.estimatedTokens ?? 0
        }
      })
      setTask(started)
      setSelectedChanges(new Set())
      refreshHistory()
    } catch (error) {
      const text = error instanceof Error ? error.message : '任务启动失败'
      setMessage(text)
      setTask((current) =>
        current?.taskId === taskId ? { ...current, status: 'failed', error: text } : current
      )
    } finally {
      setBusy(false)
    }
  }

  const cancelTask = async (): Promise<void> => {
    if (!task) return
    setBusy(true)
    try {
      await api.cancelAgentTask(task.taskId)
    } finally {
      setBusy(false)
    }
  }

  const applyChanges = async (): Promise<void> => {
    if (!task || selectedChanges.size === 0) return
    setBusy(true)
    setMessage(null)
    try {
      const result = await api.applyAgentChanges({
        taskId: task.taskId,
        paths: [...selectedChanges]
      })
      const summary = [`已应用 ${result.applied.length} 个文件`]
      if (result.conflicts.length) summary.push(`${result.conflicts.length} 个冲突已跳过`)
      setMessage(summary.join('，'))
      setSelectedChanges((current) => {
        const next = new Set(current)
        for (const applied of result.applied) next.delete(applied)
        return next
      })
      setTask((current) =>
        current
          ? {
              ...current,
              changedFiles: current.changedFiles.filter(
                (file) => !result.applied.includes(file.path)
              )
            }
          : current
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '应用修改失败')
    } finally {
      setBusy(false)
    }
  }

  const discardTask = async (): Promise<void> => {
    if (!task) return
    if (
      settings.general.confirmBeforeDiscard &&
      task.changedFiles.length > 0 &&
      !window.confirm('确定放弃这个任务及其未应用修改吗？')
    ) {
      return
    }
    setBusy(true)
    try {
      await api.discardAgentTask(task.taskId)
      setTask(null)
      setOutput([])
      setSelectedChanges(new Set())
      setMessage('任务已放弃')
      refreshHistory()
    } finally {
      setBusy(false)
    }
  }

  const showHistoryTask = (item: AgentTask): void => {
    if (item.taskId === task?.taskId) return
    void api.getAgentTask(item.taskId).then((latest) => {
      const next = latest ?? item
      setTask(next)
      setOutput([])
      outputCounter.current = 0
      outputBuffer.current = { stdout: '', stderr: '' }
      setSelectedChanges(new Set(next.changedFiles.map((file) => file.path)))
      setMessage(null)
    })
  }

  const contextSummary = contextEstimate
    ? `${contextEstimate.fileCount} 个文件 · ${contextEstimate.estimatedTokens.toLocaleString()} / ${CONTEXT_TOKEN_BUDGET.toLocaleString()} tokens`
    : contextPaths.length > 0
      ? '分析中…'
      : '未添加'

  return (
    <div className="task-workspace">
      <div className="task-toolbar">
        <label className="task-provider">
          <Bot size={14} />
          <select
            aria-label="选择任务 Agent"
            value={provider}
            disabled={!!selectedSkill}
            onChange={(event) => setProvider(event.currentTarget.value as AgentProvider)}
          >
            <option
              value="claude"
              disabled={availability.find((item) => item.provider === 'claude')?.available === false}
            >
              Claude
            </option>
            <option
              value="codex"
              disabled={availability.find((item) => item.provider === 'codex')?.available === false}
            >
              Codex
            </option>
          </select>
        </label>
        {settings.ai.bypassPermissions && (
          <span
            className="task-permission"
            title="Agent 权限确认已绕过；临时副本用于审阅文件修改，不构成系统沙箱"
          >
            <ShieldAlert size={12} />
            bypass · 临时副本
          </span>
        )}
      </div>

      <div className="task-scroll">
        <section className="task-compose">
          {!selectedSkill && (
            <div className="quick-task-grid">
              {QUICK_TASKS.map((item) => (
                <button key={item.label} onClick={() => setPrompt(item.prompt)}>
                  {item.label}
                </button>
              ))}
            </div>
          )}
          <textarea
            value={prompt}
            rows={5}
            placeholder={
              selectedSkill
                ? `补充 ${selectedSkill.name} 的执行要求（可选）…`
                : '描述你希望 AI 在项目中完成的任务…'
            }
            onChange={(event) => setPrompt(event.currentTarget.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void startTask()
            }}
          />

          <details className="task-fold">
            <summary>
              <Sparkles size={13} />
              <strong>Skill</strong>
              <span>{selectedSkill ? `${selectedSkill.name} · ${selectedSkill.command}` : '自由任务'}</span>
              <ChevronDown size={13} />
            </summary>
            <div className="task-fold-body">
              <div className="skill-search">
                <Search size={13} />
                <input
                  value={skillSearch}
                  placeholder="搜索 Skill…"
                  onChange={(event) => setSkillSearch(event.currentTarget.value)}
                />
                <button
                  className="icon-btn"
                  title="刷新 Claude Skills"
                  disabled={skillsLoading}
                  onClick={() => void refreshSkills()}
                >
                  <RefreshCw size={13} />
                </button>
              </div>
              <div className="skill-list">
                <button
                  className={`skill-card${selectedSkillId === null ? ' selected' : ''}`}
                  onClick={() => chooseSkill(null)}
                >
                  <strong>自由任务</strong>
                  <small>直接使用自定义指令</small>
                </button>
                {filteredSkills.map((skill) => (
                  <button
                    key={skill.id}
                    className={`skill-card${selectedSkillId === skill.id ? ' selected' : ''}`}
                    disabled={!skill.available}
                    onClick={() => chooseSkill(skill)}
                    title={skill.description}
                  >
                    <span>
                      <strong>{skill.name}</strong>
                      <i>{skill.source}</i>
                    </span>
                    <small>{skill.description}</small>
                  </button>
                ))}
              </div>
              {selectedSkill && (
                <div className="task-execution-summary">
                  Claude · {selectedSkill.command} ·{' '}
                  {settings.ai.bypassPermissions ? 'bypass' : '受限权限'}
                </div>
              )}
            </div>
          </details>

          <details className="task-fold" open={contextPaths.length > 0}>
            <summary>
              <FolderOpen size={13} />
              <strong>上下文</strong>
              <span className={contextOverBudget ? 'over-budget' : undefined}>{contextSummary}</span>
              <ChevronDown size={13} />
            </summary>
            <div className="task-fold-body">
              <div className="context-basket">
                {contextEstimate?.items.map((item) => (
                  <div className="context-item" key={item.path}>
                    {item.isDirectory ? <FolderOpen size={13} /> : <FileText size={13} />}
                    {item.isDirectory ? (
                      <span className="context-directory" title={item.relativePath}>
                        {item.relativePath}
                      </span>
                    ) : (
                      <button
                        title={item.relativePath}
                        onClick={() => onOpenDocumentPath(item.relativePath)}
                      >
                        {item.relativePath}
                      </button>
                    )}
                    <span>{item.estimatedTokens.toLocaleString()}</span>
                    <button
                      className="icon-btn"
                      title="移除上下文"
                      onClick={() => onRemoveContextPath(item.path)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                {contextPaths.length === 0 && (
                  <div className="context-empty">在文件树右键选择“添加到 AI 上下文”。</div>
                )}
              </div>
              {contextOverBudget && (
                <div className="task-inline-error">
                  上下文超过 {CONTEXT_TOKEN_BUDGET.toLocaleString()} tokens，请移除部分文件。
                </div>
              )}
              {contextError && <div className="task-inline-error">{contextError}</div>}
            </div>
          </details>

          <div className="task-compose-actions">
            <span>⌘↵ 运行</span>
            <button className="text-btn primary" disabled={!canStart || busy} onClick={startTask}>
              <Play size={13} fill="currentColor" />
              运行任务
            </button>
          </div>
          {!projectRoot && <div className="task-inline-error">请先打开项目文件夹。</div>}
          {providerState?.available === false && (
            <div className="task-inline-error">
              未检测到 {provider === 'claude' ? 'Claude' : 'Codex'} CLI，请先安装并确认命令在
              PATH 中。
            </div>
          )}
        </section>

        {task && (
          <section className="task-run">
            <div className="task-run-head">
              <span className={`task-state ${task.status}`}>
                <i />
                {TASK_STATUS[task.status]}
              </span>
              <span className="task-time">
                {new Date(task.createdAt).toLocaleTimeString()}
                {formatDuration(task) ? ` · ${formatDuration(task)}` : ''}
              </span>
              {(task.status === 'running' || task.status === 'preparing') && (
                <button className="text-btn danger" disabled={busy} onClick={cancelTask}>
                  <Square size={11} fill="currentColor" />
                  停止
                </button>
              )}
              {isFinished(task.status) && (
                <button
                  className="icon-btn"
                  title="重新运行"
                  aria-label="重新运行当前任务"
                  onClick={startTask}
                >
                  <RotateCcw size={14} />
                </button>
              )}
            </div>
            {task.error && (
              <div className="task-error">
                <CircleAlert size={14} />
                {task.error}
              </div>
            )}
            {(task.skill || (task.context?.paths.length ?? 0) > 0) && (
              <div className="task-run-meta">
                {task.skill && <span>{task.skill.command}</span>}
                {task.context?.paths.map((item) => (
                  <button key={item} onClick={() => onOpenDocumentPath(item)}>
                    {item}
                  </button>
                ))}
              </div>
            )}
            {output.length > 0 && (
              <div
                className="task-output"
                aria-live="polite"
                ref={outputRef}
                onScroll={(event) => {
                  const host = event.currentTarget
                  outputPinned.current =
                    host.scrollHeight - host.scrollTop - host.clientHeight < 24
                }}
              >
                {output.map((line) => (
                  <p key={line.id} className={line.tone}>
                    {renderOutputText(
                      line.text,
                      [
                        ...(task.context?.paths ?? []),
                        ...task.changedFiles.map((file) => file.path)
                      ],
                      onOpenDocumentPath
                    )}
                  </p>
                ))}
              </div>
            )}
          </section>
        )}

        {task && task.changedFiles.length > 0 && (
          <section className="task-changes">
            <div className="task-section-head">
              <strong>文件修改</strong>
              <span>
                已选 {selectedChanges.size} / {task.changedFiles.length} 个文件
              </span>
            </div>
            <div className="change-list">
              {task.changedFiles.map((file) => (
                <details key={file.path} className="change-card">
                  <summary>
                    <input
                      type="checkbox"
                      aria-label={`选择 ${file.path}`}
                      checked={selectedChanges.has(file.path)}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        setSelectedChanges((current) => {
                          const next = new Set(current)
                          if (event.currentTarget.checked) next.add(file.path)
                          else next.delete(file.path)
                          return next
                        })
                      }}
                    />
                    <span className={`change-kind ${file.changeType}`}>
                      {file.changeType === 'added' ? 'A' : file.changeType === 'deleted' ? 'D' : 'M'}
                    </span>
                    <span title={file.path}>{file.path}</span>
                    <ChevronDown size={13} />
                  </summary>
                  <pre>{file.diff ?? (file.binary ? '二进制文件，无法显示差异。' : '差异内容过大。')}</pre>
                </details>
              ))}
            </div>
            <div className="change-actions">
              <button className="text-btn danger" disabled={busy} onClick={discardTask}>
                <Trash2 size={13} />
                放弃任务
              </button>
              <button
                className="text-btn primary"
                disabled={busy || selectedChanges.size === 0}
                onClick={applyChanges}
              >
                <Check size={13} />
                应用所选修改
              </button>
            </div>
          </section>
        )}

        {history.length > 1 && (
          <details className="task-fold task-history">
            <summary>
              <History size={13} />
              <strong>历史任务</strong>
              <span>{history.length} 条</span>
              <ChevronDown size={13} />
            </summary>
            <div className="task-fold-body">
              {history.map((item) => (
                <button
                  key={item.taskId}
                  className={`task-history-item${item.taskId === task?.taskId ? ' selected' : ''}`}
                  onClick={() => showHistoryTask(item)}
                >
                  <span className={`task-state ${item.status}`}>
                    <i />
                  </span>
                  <span className="task-history-prompt" title={item.prompt || item.skill?.name}>
                    {item.skill?.name ?? ''}
                    {item.skill && item.prompt ? ' · ' : ''}
                    {item.prompt || (item.skill ? '' : '（无提示词）')}
                  </span>
                  <span className="task-history-time">
                    {new Date(item.createdAt).toLocaleTimeString()}
                  </span>
                </button>
              ))}
            </div>
          </details>
        )}

        {message && <div className="task-message">{message}</div>}
      </div>
    </div>
  )
}

function applyTaskEvent(current: AgentTask, event: AgentTaskEvent): AgentTask {
  if (event.kind === 'status' && event.status) return { ...current, status: event.status }
  if (event.kind === 'changes') return { ...current, changedFiles: event.changedFiles ?? [] }
  if (event.kind === 'error') return { ...current, error: event.error }
  return current
}

function isFinished(status?: AgentTask['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function formatDuration(task: AgentTask): string | null {
  if (!task.startedAt || !task.endedAt || task.endedAt <= task.startedAt) return null
  const seconds = Math.round((task.endedAt - task.startedAt) / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m${seconds % 60 ? ` ${seconds % 60}s` : ''}`
}

function appendUniqueOutput(
  current: AgentOutputLine[],
  incoming: AgentOutputLine[]
): AgentOutputLine[] {
  const next = [...current]
  for (const line of incoming) {
    if (next[next.length - 1]?.text === line.text) continue
    next.push(line)
  }
  return next.slice(-300)
}

function playTaskBell(): void {
  const context = new window.AudioContext()
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.frequency.value = 760
  gain.gain.setValueAtTime(0.08, context.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.28)
  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start()
  oscillator.stop(context.currentTime + 0.3)
  window.setTimeout(() => void context.close(), 400)
}

function renderOutputText(
  text: string,
  knownPaths: string[],
  onOpen: (path: string) => void
): Array<string | JSX.Element> {
  const paths = [...new Set(knownPaths)].filter(Boolean).sort((a, b) => b.length - a.length)
  if (!paths.length) return [text]
  const escaped = paths.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`(${escaped.join('|')})`, 'g')
  return text.split(pattern).map((part, index) =>
    paths.includes(part) ? (
      <button className="task-output-link" key={`${part}-${index}`} onClick={() => onOpen(part)}>
        {part}
      </button>
    ) : (
      part
    )
  )
}
