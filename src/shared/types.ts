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
}
