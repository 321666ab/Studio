import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import type {
  AgentProvider,
  AgentSkill,
  AgentTask,
  AgentTaskEvent,
  AgentTaskRequest,
  AgentTaskStatus,
  ApplyChangesRequest,
  ApplyChangesResult,
  ApplyConflict,
  ChangedFile
} from '../shared/types.js'
import { buildAgentCommand } from './agentCommand.js'
import {
  prepareWorkspace,
  snapshotTree,
  toPosix,
  type PreparedWorkspace
} from './workspace.js'
import {
  computeChanges,
  decideApply,
  hashBuffer,
  type ConflictReason
} from './workspaceDiff.js'
import { resolveWithinRoot } from './security.js'
import { DEFAULT_CONTEXT_TOKEN_BUDGET, estimateContext } from './contextService.js'

/** Emitter signature for task lifecycle/output events. */
export type AgentEventSink = (event: AgentTaskEvent) => void

interface RunningTask {
  task: AgentTask
  workspace?: PreparedWorkspace
  child?: ChildProcess
  timeout?: NodeJS.Timeout
  killTimer?: NodeJS.Timeout
  /** Set when cancel() was requested so exit handling reports 'cancelled'. */
  cancelled: boolean
  /** Set when the manager, rather than the user, stopped the task at its deadline. */
  timedOut: boolean
}

export interface AgentTaskManagerOptions {
  /** Resolve the source project root a task runs against. */
  getRoot: () => string
  /** Default permission-bypass setting (from settings.ai.bypassPermissions). */
  getBypass: () => boolean
  /** Hard timeout for a single run, in milliseconds. */
  getTimeoutMs: () => number
  /** Provider-specific model; empty means inherit CLI configuration. */
  getModel: (provider: AgentProvider) => string
  /** Resolve an available Claude skill by its Studio identifier. */
  getSkill: (skillId: string) => Promise<AgentSkill | null>
  /** Resolve the provider CLI to an absolute path in the user's login shell. */
  getExecutable: (provider: AgentProvider) => Promise<string>
  /** PATH captured from the user's login shell (Finder apps inherit a minimal PATH). */
  getLoginPath: () => string
  /** Receives every task event for forwarding to the renderer. */
  emit: AgentEventSink
}

/**
 * Owns the lifecycle of agent tasks: prepares an isolated workspace, runs the
 * provider CLI non-interactively, captures the resulting file changes, and
 * applies or discards them with hash-based conflict protection.
 */
export class AgentTaskManager {
  private readonly tasks = new Map<string, RunningTask>()

  constructor(private readonly options: AgentTaskManagerOptions) {}

  list(): AgentTask[] {
    return [...this.tasks.values()].map((entry) => entry.task)
  }

  get(taskId: string): AgentTask | null {
    return this.tasks.get(taskId)?.task ?? null
  }

  /** Begin a task: validate, prepare workspace, spawn the CLI. */
  async start(request: AgentTaskRequest): Promise<AgentTask> {
    const provider = validProvider(request?.provider)
    const userPrompt = validPrompt(request?.prompt, !!request?.skill)
    const taskId = request?.taskId ? validTaskId(request.taskId) : randomUUID()
    if (this.tasks.has(taskId)) throw new Error('任务标识已存在')

    const task: AgentTask = {
      taskId,
      provider,
      prompt: userPrompt,
      status: 'pending',
      createdAt: Date.now(),
      skill: request.skill,
      context: request.context,
      changedFiles: []
    }
    const entry: RunningTask = { task, cancelled: false, timedOut: false }
    this.tasks.set(taskId, entry)

    this.setStatus(entry, 'preparing')
    let executable: string
    try {
      const root = this.options.getRoot()
      const skill = request.skill ? await this.validateSkill(request.skill.id, request.skill.command, provider) : null
      const contextEstimate = request.context?.paths?.length
        ? await estimateContext(root, request.context.paths)
        : { items: [], totalBytes: 0, estimatedTokens: 0, fileCount: 0 }
      if (contextEstimate.estimatedTokens > DEFAULT_CONTEXT_TOKEN_BUDGET) {
        throw new Error(
          `AI 上下文约 ${contextEstimate.estimatedTokens.toLocaleString()} tokens，超过 ${DEFAULT_CONTEXT_TOKEN_BUDGET.toLocaleString()} 上限`
        )
      }
      const contextPaths = contextEstimate.items.map((item) => item.relativePath)
      task.context = {
        paths: contextPaths,
        estimatedTokens: contextEstimate.estimatedTokens
      }
      if (skill) {
        task.skill = {
          id: skill.id,
          command: skill.command,
          source: skill.source,
          name: skill.name
        }
      }
      task.prompt = buildTaskPrompt(userPrompt, task.skill, contextPaths)
      executable = await this.options.getExecutable(provider)
      entry.workspace = await prepareWorkspace(root, contextPaths)
      task.workspacePath = entry.workspace.path
      if (entry.cancelled) {
        await entry.workspace.cleanup().catch(() => undefined)
        entry.workspace = undefined
        this.finalizeCancelled(entry)
        return task
      }
    } catch (err) {
      this.fail(entry, errorMessage(err))
      return task
    }

    this.spawn(entry, provider, task.prompt, executable)
    return task
  }

  /** Request cancellation; the exit handler finalizes state to 'cancelled'. */
  async cancel(taskId: string): Promise<void> {
    const entry = this.tasks.get(validTaskId(taskId))
    if (!entry) throw new Error('任务不存在')
    if (isTerminal(entry.task.status)) return
    entry.cancelled = true
    if (entry.child && entry.child.exitCode === null) {
      terminateChild(entry)
    } else if (entry.task.status === 'preparing') {
      // Workspace prep cannot be interrupted cleanly; mark on completion.
      this.finalizeCancelled(entry)
    }
  }

  /**
   * Apply selected (or all) changed files back to the source root, refusing any
   * file whose source no longer matches the baseline the agent started from.
   */
  async apply(request: ApplyChangesRequest): Promise<ApplyChangesResult> {
    const entry = this.tasks.get(validTaskId(request?.taskId))
    if (!entry) throw new Error('任务不存在')
    if (!entry.workspace) throw new Error('任务没有可用的工作区')

    const root = entry.workspace.sourceRoot
    const selected = selectChanges(entry.task.changedFiles, request?.paths)

    const applied: string[] = []
    const conflicts: ApplyConflict[] = []

    for (const change of selected) {
      try {
        const sourceHash = await currentSourceHash(root, change.path)
        const decision = decideApply(change.baselineHash, sourceHash)
        if (!decision.apply) {
          conflicts.push({
            path: change.path,
            reason: decision.reason ?? 'error',
            message: conflictMessage(decision.reason)
          })
          continue
        }
        await applyOne(entry.workspace.path, root, change)
        applied.push(change.path)
      } catch (err) {
        conflicts.push({ path: change.path, reason: 'error', message: errorMessage(err) })
      }
    }
    if (applied.length > 0) {
      const appliedSet = new Set(applied)
      entry.task.changedFiles = entry.task.changedFiles.filter(
        (change) => !appliedSet.has(change.path)
      )
      this.options.emit({
        taskId: entry.task.taskId,
        kind: 'changes',
        changedFiles: entry.task.changedFiles
      })
    }
    return { applied, conflicts }
  }

  /** Discard a task's workspace and forget it. */
  async discard(taskId: string): Promise<void> {
    const entry = this.tasks.get(validTaskId(taskId))
    if (!entry) throw new Error('任务不存在')
    if (entry.child && entry.child.exitCode === null) {
      try {
        entry.child.kill('SIGKILL')
      } catch {
        // ignore
      }
    }
    if (entry.timeout) clearTimeout(entry.timeout)
    if (entry.killTimer) clearTimeout(entry.killTimer)
    await entry.workspace?.cleanup()
    this.tasks.delete(entry.task.taskId)
  }

  /** Kill and clean up every task (app shutdown / project switch). */
  async disposeAll(): Promise<void> {
    const ids = [...this.tasks.keys()]
    await Promise.all(ids.map((id) => this.discard(id).catch(() => undefined)))
  }

  // --- internals ----------------------------------------------------------

  private spawn(
    entry: RunningTask,
    provider: AgentProvider,
    prompt: string,
    executable: string
  ): void {
    const workspace = entry.workspace!
    const command = buildAgentCommand({
      provider,
      prompt,
      bypassPermissions: this.options.getBypass(),
      model: this.options.getModel(provider) || undefined,
      skipGitRepoCheck: provider === 'codex' && !workspace.isGitWorktree
    })
    let child: ChildProcess
    try {
      child = spawn(executable, command.args, {
        cwd: workspace.path,
        env: agentEnvironment(process.env, this.options.getLoginPath()),
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (err) {
      this.fail(entry, errorMessage(err))
      return
    }
    entry.child = child
    entry.task.startedAt = Date.now()
    this.setStatus(entry, 'running')

    child.stdout?.setEncoding('utf-8')
    child.stderr?.setEncoding('utf-8')
    child.stdout?.on('data', (data: string) =>
      this.options.emit({ taskId: entry.task.taskId, kind: 'stdout', data })
    )
    child.stderr?.on('data', (data: string) =>
      this.options.emit({ taskId: entry.task.taskId, kind: 'stderr', data })
    )

    const timeoutMs = this.options.getTimeoutMs()
    entry.timeout = setTimeout(() => {
      entry.timedOut = true
      entry.task.error = `任务超过 ${Math.round(timeoutMs / 60_000)} 分钟，已停止`
      terminateChild(entry)
    }, timeoutMs)

    child.on('error', (err) => {
      if (entry.timeout) clearTimeout(entry.timeout)
      if (entry.killTimer) clearTimeout(entry.killTimer)
      this.fail(entry, errorMessage(err))
    })
    child.on('exit', (code) => {
      if (entry.timeout) clearTimeout(entry.timeout)
      if (entry.killTimer) clearTimeout(entry.killTimer)
      void this.onExit(entry, code)
    })
  }

  private async onExit(entry: RunningTask, code: number | null): Promise<void> {
    if (isTerminal(entry.task.status)) return
    entry.task.exitCode = code ?? undefined
    entry.task.endedAt = Date.now()

    // Capture the resulting changes regardless of exit code; a cancelled or
    // failed run may still have produced useful partial edits.
    try {
      if (entry.workspace) {
        const current = await snapshotTree(entry.workspace.path)
        entry.task.changedFiles = computeChanges(entry.workspace.baseline, current)
        this.options.emit({
          taskId: entry.task.taskId,
          kind: 'changes',
          changedFiles: entry.task.changedFiles
        })
      }
    } catch (err) {
      this.options.emit({ taskId: entry.task.taskId, kind: 'error', error: errorMessage(err) })
    }

    if (entry.timedOut) {
      this.fail(entry, entry.task.error ?? '任务执行超时')
    } else if (entry.cancelled) {
      this.setStatus(entry, 'cancelled')
    } else if (code === 0) {
      this.setStatus(entry, 'completed')
    } else {
      entry.task.error = `进程以代码 ${code ?? 'null'} 退出`
      this.fail(entry, entry.task.error)
    }
  }

  private finalizeCancelled(entry: RunningTask): void {
    entry.task.endedAt = Date.now()
    this.setStatus(entry, 'cancelled')
  }

  private fail(entry: RunningTask, error: string): void {
    entry.task.error = error
    entry.task.endedAt = entry.task.endedAt ?? Date.now()
    entry.task.status = 'failed'
    this.options.emit({ taskId: entry.task.taskId, kind: 'error', error })
    this.options.emit({ taskId: entry.task.taskId, kind: 'status', status: 'failed' })
  }

  private setStatus(entry: RunningTask, status: AgentTaskStatus): void {
    entry.task.status = status
    this.options.emit({ taskId: entry.task.taskId, kind: 'status', status })
  }

  private async validateSkill(
    skillId: string,
    command: string,
    provider: AgentProvider
  ): Promise<AgentSkill> {
    if (provider !== 'claude') throw new Error('Claude Skill 只能由 Claude 执行')
    const skill = await this.options.getSkill(skillId)
    if (!skill || !skill.available || skill.command !== command) {
      throw new Error('所选 Skill 不存在或当前不可用，请刷新能力列表')
    }
    return skill
  }
}

// --- free helpers ---------------------------------------------------------

/**
 * Environment for a non-interactive agent run. We inherit the user's PATH etc.
 * but force NO_COLOR so ANSI escape codes never corrupt the JSON stream.
 */
export function agentEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  loginPath?: string
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') env[key] = value
  }
  env.NO_COLOR = '1'
  if (loginPath) env.PATH = loginPath
  delete env.FORCE_COLOR
  delete env.CLICOLOR_FORCE
  delete env.CLAUDECODE
  delete env.CLAUDE_CODE_ENTRYPOINT
  delete env.CLAUDE_CODE_SESSION
  delete env.CODEX_THREAD_ID
  delete env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE
  return env
}

/** Filter a task's changes to a requested subset of paths (all when empty). */
export function selectChanges(changes: ChangedFile[], paths?: string[]): ChangedFile[] {
  if (!paths || paths.length === 0) return changes
  const wanted = new Set(paths.map((p) => toPosix(p)))
  return changes.filter((change) => wanted.has(change.path))
}

/** Hash the source file at `rel`, or null when it does not exist. */
async function currentSourceHash(root: string, rel: string): Promise<string | null> {
  try {
    const full = await resolveWithinRoot(root, path.join(root, rel))
    const buffer = await fs.readFile(full)
    return hashBuffer(buffer)
  } catch {
    return null
  }
}

/** Copy or delete a single changed file from the workspace into the source. */
async function applyOne(workspacePath: string, root: string, change: ChangedFile): Promise<void> {
  const dest = await resolveWithinRoot(root, path.join(root, change.path))
  if (change.changeType === 'deleted') {
    await fs.rm(dest, { force: true })
    return
  }
  const from = path.join(workspacePath, change.path)
  await fs.mkdir(path.dirname(dest), { recursive: true })
  await fs.copyFile(from, dest)
}

function conflictMessage(reason: ConflictReason | undefined): string {
  switch (reason) {
    case 'baseline-changed':
      return '源文件在任务运行期间被修改，已跳过以避免覆盖'
    case 'missing':
      return '源文件已不存在'
    default:
      return '应用更改失败'
  }
}

function isTerminal(status: AgentTaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function terminateChild(entry: RunningTask): void {
  const child = entry.child
  if (!child || child.exitCode !== null) return
  try {
    child.kill('SIGTERM')
  } catch {
    return
  }
  if (entry.killTimer) clearTimeout(entry.killTimer)
  entry.killTimer = setTimeout(() => {
    if (child.exitCode !== null) return
    try {
      child.kill('SIGKILL')
    } catch {
      // Already exited.
    }
  }, 3000)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function validProvider(value: unknown): AgentProvider {
  if (value !== 'claude' && value !== 'codex') throw new Error('代理类型无效')
  return value
}

function validPrompt(value: unknown, allowEmpty = false): string {
  if (typeof value !== 'string') throw new Error('任务指令无效')
  if (!allowEmpty && value.trim().length === 0) throw new Error('任务指令不能为空')
  if (value.length > 100_000) throw new Error('任务指令过长')
  return value.trim()
}

function validTaskId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) {
    throw new Error('任务标识无效')
  }
  return value
}

export function buildTaskPrompt(
  prompt: string,
  skill?: AgentTask['skill'],
  contextPaths: string[] = []
): string {
  const parts: string[] = []
  if (skill) parts.push(`${skill.command}${prompt ? ` ${prompt}` : ''}`)
  else if (prompt) parts.push(prompt)
  if (contextPaths.length > 0) {
    parts.push(
      `仅使用以下项目上下文完成任务：\n${contextPaths.map((item) => `- ${item}`).join('\n')}`
    )
  } else {
    parts.push('请在当前项目中完成任务，并尽量减少不必要的文件修改。')
  }
  parts.push('输出中引用结论来源时，请使用项目相对路径。')
  return parts.join('\n\n')
}
