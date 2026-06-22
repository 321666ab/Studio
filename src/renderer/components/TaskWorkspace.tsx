import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  FileText,
  Play,
  RotateCcw,
  ShieldAlert,
  Square,
  Trash2
} from 'lucide-react'
import type {
  AgentAvailability,
  AgentProvider,
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

interface TaskWorkspaceProps {
  projectRoot: string | null
  selectedPath: string | null
  settings: Settings
  availability: AgentAvailability[]
}

export function TaskWorkspace({
  projectRoot,
  selectedPath,
  settings,
  availability
}: TaskWorkspaceProps): JSX.Element {
  const [provider, setProvider] = useState<AgentProvider>(settings.ai.defaultProvider)
  const [prompt, setPrompt] = useState('')
  const [task, setTask] = useState<AgentTask | null>(null)
  const [output, setOutput] = useState<AgentOutputLine[]>([])
  const [selectedChanges, setSelectedChanges] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const outputCounter = useRef(0)
  const outputBuffer = useRef({ stdout: '', stderr: '' })
  const activeTaskId = useRef<string | null>(null)

  useEffect(() => setProvider(settings.ai.defaultProvider), [settings.ai.defaultProvider])

  useEffect(() => {
    activeTaskId.current = task?.taskId ?? null
  }, [task?.taskId])

  useEffect(() => {
    void api.listAgentTasks().then((tasks) => {
      const latest = tasks.sort((a, b) => b.createdAt - a.createdAt)[0]
      setTask(latest ?? null)
      setOutput([])
      outputCounter.current = 0
      outputBuffer.current = { stdout: '', stderr: '' }
      setSelectedChanges(new Set(latest?.changedFiles.map((file) => file.path) ?? []))
    }).catch(() => undefined)
  }, [projectRoot])

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
        void api.getAgentTask(event.taskId).then((latest) => {
          if (!latest) return
          setTask(latest)
          setSelectedChanges(new Set(latest.changedFiles.map((file) => file.path)))
          if (
            settings.notifications.soundEnabled &&
            latest.status === 'completed'
          ) {
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
    settings.notifications.notifyOnTaskComplete,
    settings.notifications.notifyOnTaskError,
    settings.notifications.soundEnabled
  ])

  const relativePath = useMemo(() => {
    if (!selectedPath || !projectRoot) return null
    const prefix = projectRoot.endsWith('/') ? projectRoot : `${projectRoot}/`
    return selectedPath.startsWith(prefix) ? selectedPath.slice(prefix.length) : selectedPath
  }, [projectRoot, selectedPath])

  const providerState = availability.find((item) => item.provider === provider)
  const canStart =
    !!projectRoot &&
    prompt.trim().length > 0 &&
    providerState?.available !== false &&
    task?.status !== 'running' &&
    task?.status !== 'preparing'

  const startTask = async (): Promise<void> => {
    if (!canStart) return
    setBusy(true)
    setMessage(null)
    setOutput([])
    outputCounter.current = 0
    outputBuffer.current = { stdout: '', stderr: '' }
    const taskId = window.crypto.randomUUID()
    const provisional: AgentTask = {
      taskId,
      provider,
      prompt: prompt.trim(),
      status: 'pending',
      createdAt: Date.now(),
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
      const context = relativePath
        ? `\n\n当前文档：${relativePath}\n请优先检查该文件，并仅在完成任务所必需时修改项目文件。`
        : '\n\n请在当前项目中完成任务，并尽量减少不必要的文件修改。'
      const started = await api.startAgentTask({
        taskId,
        provider,
        prompt: `${prompt.trim()}${context}`
      })
      setTask(started)
      setSelectedChanges(new Set())
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
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="task-workspace">
      <div className="task-toolbar">
        <label className="task-provider">
          <Bot size={14} />
          <select
            aria-label="选择任务 Agent"
            value={provider}
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
        <span
          className="task-permission"
          title="Agent 权限确认已绕过；临时副本用于审阅文件修改，不构成系统沙箱"
        >
          <ShieldAlert size={12} />
          bypass · 临时副本
        </span>
      </div>

      <div className="task-scroll">
        <section className="task-compose">
          <div className="task-context">
            {relativePath ? (
              <span title={relativePath}>
                <FileText size={12} />
                {relativePath}
              </span>
            ) : (
              <span className="muted">未关联当前文档</span>
            )}
          </div>
          <div className="quick-task-grid">
            {QUICK_TASKS.map((item) => (
              <button key={item.label} onClick={() => setPrompt(item.prompt)}>
                {item.label}
              </button>
            ))}
          </div>
          <textarea
            value={prompt}
            rows={5}
            placeholder="描述你希望 AI 在项目中完成的任务…"
            onChange={(event) => setPrompt(event.currentTarget.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void startTask()
            }}
          />
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
              未检测到 {provider === 'claude' ? 'Claude' : 'Codex'} CLI。
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
              <span className="task-time">{new Date(task.createdAt).toLocaleTimeString()}</span>
              {(task.status === 'running' || task.status === 'preparing') && (
                <button className="text-btn danger" disabled={busy} onClick={cancelTask}>
                  <Square size={11} fill="currentColor" />
                  停止
                </button>
              )}
              {isFinished(task.status) && (
                <button className="icon-btn" title="重新运行" aria-label="重新运行当前任务" onClick={startTask}>
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
            {output.length > 0 && (
              <div className="task-output" aria-live="polite">
                {output.map((line) => (
                  <p key={line.id} className={line.tone}>
                    {line.text}
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
              <span>{task.changedFiles.length} 个文件</span>
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
