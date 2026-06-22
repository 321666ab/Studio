// Shared types and IPC channel contract between main, preload, and renderer.

export interface ProjectInfo {
  root: string
  name: string
}

export interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
  isSymbolicLink: boolean
}

export interface FileInfo {
  path: string
  size: number
  isDirectory: boolean
  isSymbolicLink: boolean
  mtimeMs: number
  ctimeMs: number
}

export interface ReadFileResult {
  /** Decoded text content (may be truncated when truncated=true). */
  content: string
  /** Encoding used for decoding. */
  encoding: 'utf-8' | 'gb18030'
  /** True when the file exceeded the size limit and was not fully read. */
  truncated: boolean
  /** Full size in bytes on disk. */
  size: number
}

export interface WriteFileResult {
  size: number
  mtimeMs: number
}

export interface QuickLookPreview {
  html: string
}

export interface PtyDataEvent {
  terminalId: string
  data: string
}

export interface PtyExitEvent {
  terminalId: string
  exitCode: number
  signal?: number
}

export type PtyAgent = 'claude' | 'codex'

export interface PtyCreateOptions {
  terminalId: string
  cols: number
  rows: number
  agent: PtyAgent
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** The agent backends the workbench can drive. */
export type AgentProvider = 'claude' | 'codex'

export type ColorScheme = 'system' | 'light' | 'dark'

export interface GeneralSettings {
  /** Reopen the last project automatically on launch. */
  restoreLastProject: boolean
  /** Last successfully opened project. Managed by the main process. */
  lastProjectPath: string | null
  /** Confirm before discarding unsaved or unapplied agent changes. */
  confirmBeforeDiscard: boolean
}

export interface AiSettings {
  /** Default agent used when starting a task without an explicit choice. */
  defaultProvider: AgentProvider
  /** Empty string inherits the provider CLI's configured default model. */
  claudeModel: string
  /** Empty string inherits the provider CLI's configured default model. */
  codexModel: string
  /**
   * Run agents with their permission/approval prompts bypassed. Mirrors the
   * terminal's existing dangerous-bypass behavior; defaults to true.
   */
  bypassPermissions: boolean
  /** Hard ceiling on a single task's wall-clock runtime, in milliseconds. */
  taskTimeoutMs: number
}

export interface NotificationSettings {
  /** Emit a notification when an agent task finishes. */
  notifyOnTaskComplete: boolean
  /** Emit a notification when an agent task fails. */
  notifyOnTaskError: boolean
  /** Play a sound alongside notifications. */
  soundEnabled: boolean
}

export interface TerminalSettings {
  fontSize: number
  /** Scrollback buffer size in lines. */
  scrollback: number
}

export interface LayoutSettings {
  leftWidth: number
  rightWidth: number
}

export interface AppearanceSettings {
  colorScheme: ColorScheme
  panelOpacity: number
  blur: number
  animationMs: number
  radius: number
  inset: number
}

/** The complete persisted settings document (without its version envelope). */
export interface Settings {
  general: GeneralSettings
  ai: AiSettings
  notifications: NotificationSettings
  terminal: TerminalSettings
  appearance: AppearanceSettings
  layout: LayoutSettings
}

/** Deep-partial patch accepted by settings:update. */
export type SettingsPatch = {
  [K in keyof Settings]?: Partial<Settings[K]>
}

// ---------------------------------------------------------------------------
// Agent availability
// ---------------------------------------------------------------------------

export interface AgentAvailability {
  provider: AgentProvider
  available: boolean
  /** Absolute path to the resolved binary, when found. */
  path?: string
  /** Reported version string, when obtainable. */
  version?: string
}

// ---------------------------------------------------------------------------
// Agent tasks
// ---------------------------------------------------------------------------

export type AgentTaskStatus =
  | 'pending'
  | 'preparing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface AgentTaskRequest {
  /** Caller-supplied id; a fresh one is generated when omitted. */
  taskId?: string
  provider: AgentProvider
  /** The natural-language instruction handed to the agent. */
  prompt: string
}

export interface ChangedFile {
  /** Path relative to the workspace root, POSIX separators. */
  path: string
  /** How the file changed between baseline and current state. */
  changeType: 'added' | 'modified' | 'deleted'
  /** SHA-256 of the baseline contents, null when the file was added. */
  baselineHash: string | null
  /** SHA-256 of the current contents, null when the file was deleted. */
  currentHash: string | null
  /** Byte size of the current contents (0 for deletions). */
  size: number
  /** True when contents are binary and no text diff was produced. */
  binary: boolean
  /** Unified diff text, when one could be produced for a text file. */
  diff?: string
}

export interface AgentTask {
  taskId: string
  provider: AgentProvider
  prompt: string
  status: AgentTaskStatus
  /** Absolute path to the isolated workspace, when prepared. */
  workspacePath?: string
  createdAt: number
  startedAt?: number
  endedAt?: number
  exitCode?: number
  error?: string
  changedFiles: ChangedFile[]
}

export interface AgentTaskEvent {
  taskId: string
  /** Lifecycle transition or streamed output. */
  kind: 'status' | 'stdout' | 'stderr' | 'changes' | 'error'
  status?: AgentTaskStatus
  /** Output chunk for stdout/stderr events. */
  data?: string
  /** Populated on 'changes' events. */
  changedFiles?: ChangedFile[]
  error?: string
}

export interface ApplyChangesRequest {
  taskId: string
  /**
   * Restrict the apply to these workspace-relative paths. Omit/empty to apply
   * every changed file.
   */
  paths?: string[]
}

export interface ApplyConflict {
  path: string
  reason: 'baseline-changed' | 'missing' | 'error'
  message: string
}

export interface ApplyChangesResult {
  applied: string[]
  conflicts: ApplyConflict[]
}

/** Result wrapper used by invoke-style IPC so renderer can branch on failure. */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string }

export const IPC = {
  project: {
    select: 'project:select',
    current: 'project:current'
  },
  fs: {
    readDir: 'fs:readDir',
    fileInfo: 'fs:fileInfo',
    readFile: 'fs:readFile',
    writeMarkdown: 'fs:writeMarkdown',
    openPath: 'fs:openPath',
    quickLook: 'fs:quickLook'
  },
  pty: {
    create: 'pty:create',
    input: 'pty:input',
    resize: 'pty:resize',
    dispose: 'pty:dispose',
    onData: 'pty:onData',
    onExit: 'pty:onExit'
  },
  settings: {
    get: 'settings:get',
    update: 'settings:update',
    onOpen: 'settings:onOpen'
  },
  agent: {
    availability: 'agent:availability',
    start: 'agent:start',
    cancel: 'agent:cancel',
    get: 'agent:get',
    list: 'agent:list',
    apply: 'agent:apply',
    discard: 'agent:discard',
    onEvent: 'agent:onEvent'
  }
} as const

/** The API surface exposed to the renderer via contextBridge. */
export interface StudioApi {
  selectProject: () => Promise<IpcResult<ProjectInfo | null>>
  getCurrentProject: () => Promise<IpcResult<ProjectInfo | null>>
  readDir: (dirPath: string) => Promise<IpcResult<DirEntry[]>>
  getFileInfo: (filePath: string) => Promise<IpcResult<FileInfo>>
  readFile: (filePath: string) => Promise<IpcResult<ReadFileResult>>
  writeMarkdown: (filePath: string, content: string) => Promise<IpcResult<WriteFileResult>>
  openPath: (targetPath: string) => Promise<IpcResult<void>>
  quickLook: (filePath: string) => Promise<IpcResult<QuickLookPreview>>
  pty: {
    create: (options: PtyCreateOptions) => Promise<IpcResult<void>>
    input: (terminalId: string, data: string) => void
    resize: (terminalId: string, cols: number, rows: number) => void
    dispose: (terminalId: string) => void
    onData: (listener: (event: PtyDataEvent) => void) => () => void
    onExit: (listener: (event: PtyExitEvent) => void) => () => void
  }
  settings: {
    get: () => Promise<IpcResult<Settings>>
    update: (patch: SettingsPatch) => Promise<IpcResult<Settings>>
    onOpen: (listener: () => void) => () => void
  }
  agent: {
    availability: () => Promise<IpcResult<AgentAvailability[]>>
    start: (request: AgentTaskRequest) => Promise<IpcResult<AgentTask>>
    cancel: (taskId: string) => Promise<IpcResult<void>>
    get: (taskId: string) => Promise<IpcResult<AgentTask | null>>
    list: () => Promise<IpcResult<AgentTask[]>>
    apply: (request: ApplyChangesRequest) => Promise<IpcResult<ApplyChangesResult>>
    discard: (taskId: string) => Promise<IpcResult<void>>
    onEvent: (listener: (event: AgentTaskEvent) => void) => () => void
  }
}
