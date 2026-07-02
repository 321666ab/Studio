import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types.js'
import type {
  AgentAvailability,
  AgentContextEstimate,
  AgentSkill,
  AgentTask,
  AgentTaskEvent,
  AgentTaskRequest,
  ApplyChangesRequest,
  ApplyChangesResult,
  DirEntry,
  FileInfo,
  HotkeyTriggerEvent,
  IpcResult,
  PathContextMenuResult,
  ProjectInfo,
  PtyCreateOptions,
  PtyDataEvent,
  PtyExitEvent,
  ReadFileResult,
  ResolvedColorScheme,
  Settings,
  SettingsPatch,
  WriteFileResult,
  QuickLookPreview,
  StudioApi
} from '../shared/types.js'

const api: StudioApi = {
  selectProject: () =>
    ipcRenderer.invoke(IPC.project.select) as Promise<IpcResult<ProjectInfo | null>>,
  getCurrentProject: () =>
    ipcRenderer.invoke(IPC.project.current) as Promise<IpcResult<ProjectInfo | null>>,
  readDir: (dirPath: string) =>
    ipcRenderer.invoke(IPC.fs.readDir, dirPath) as Promise<IpcResult<DirEntry[]>>,
  getFileInfo: (filePath: string) =>
    ipcRenderer.invoke(IPC.fs.fileInfo, filePath) as Promise<IpcResult<FileInfo>>,
  readFile: (filePath: string) =>
    ipcRenderer.invoke(IPC.fs.readFile, filePath) as Promise<IpcResult<ReadFileResult>>,
  writeMarkdown: (filePath: string, content: string) =>
    ipcRenderer.invoke(IPC.fs.writeMarkdown, filePath, content) as Promise<
      IpcResult<WriteFileResult>
    >,
  openPath: (targetPath: string) =>
    ipcRenderer.invoke(IPC.fs.openPath, targetPath) as Promise<IpcResult<void>>,
  quickLook: (filePath: string) =>
    ipcRenderer.invoke(IPC.fs.quickLook, filePath) as Promise<IpcResult<QuickLookPreview>>,
  showPathContextMenu: (targetPath: string) =>
    ipcRenderer.invoke(IPC.fs.showPathContextMenu, targetPath) as Promise<
      IpcResult<PathContextMenuResult | null>
    >,
  estimateContext: (paths: string[]) =>
    ipcRenderer.invoke(IPC.fs.estimateContext, paths) as Promise<IpcResult<AgentContextEstimate>>,
  openExternalUrl: (url: string) =>
    ipcRenderer.invoke(IPC.fs.openExternalUrl, url) as Promise<IpcResult<void>>,
  pty: {
    create: (options: PtyCreateOptions) =>
      ipcRenderer.invoke(IPC.pty.create, options) as Promise<IpcResult<void>>,
    input: (terminalId: string, data: string) =>
      ipcRenderer.send(IPC.pty.input, { terminalId, data }),
    resize: (terminalId: string, cols: number, rows: number) =>
      ipcRenderer.send(IPC.pty.resize, { terminalId, cols, rows }),
    dispose: (terminalId: string) => ipcRenderer.send(IPC.pty.dispose, terminalId),
    onData: (listener: (event: PtyDataEvent) => void) => {
      const handler = (_e: unknown, payload: PtyDataEvent) => listener(payload)
      ipcRenderer.on(IPC.pty.onData, handler)
      return () => ipcRenderer.removeListener(IPC.pty.onData, handler)
    },
    onExit: (listener: (event: PtyExitEvent) => void) => {
      const handler = (_e: unknown, payload: PtyExitEvent) => listener(payload)
      ipcRenderer.on(IPC.pty.onExit, handler)
      return () => ipcRenderer.removeListener(IPC.pty.onExit, handler)
    }
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settings.get) as Promise<IpcResult<Settings>>,
    update: (patch: SettingsPatch) =>
      ipcRenderer.invoke(IPC.settings.update, patch) as Promise<IpcResult<Settings>>,
    onOpen: (listener: () => void) => {
      const handler = () => listener()
      ipcRenderer.on(IPC.settings.onOpen, handler)
      return () => ipcRenderer.removeListener(IPC.settings.onOpen, handler)
    },
    getSystemColorScheme: () =>
      ipcRenderer.invoke(IPC.settings.systemColorScheme) as Promise<
        IpcResult<ResolvedColorScheme>
      >,
    onSystemColorSchemeChange: (listener: (scheme: ResolvedColorScheme) => void) => {
      const handler = (_e: unknown, scheme: ResolvedColorScheme) => listener(scheme)
      ipcRenderer.on(IPC.settings.onSystemColorSchemeChange, handler)
      return () => ipcRenderer.removeListener(IPC.settings.onSystemColorSchemeChange, handler)
    }
  },
  hotkeys: {
    setSuspended: (suspended: boolean) => ipcRenderer.send(IPC.hotkeys.setSuspended, suspended),
    onTrigger: (listener: (event: HotkeyTriggerEvent) => void) => {
      const handler = (_e: unknown, payload: HotkeyTriggerEvent) => listener(payload)
      ipcRenderer.on(IPC.hotkeys.onTrigger, handler)
      return () => ipcRenderer.removeListener(IPC.hotkeys.onTrigger, handler)
    }
  },
  skills: {
    list: () => ipcRenderer.invoke(IPC.skills.list) as Promise<IpcResult<AgentSkill[]>>,
    refresh: () => ipcRenderer.invoke(IPC.skills.refresh) as Promise<IpcResult<AgentSkill[]>>,
    details: (skillId: string) =>
      ipcRenderer.invoke(IPC.skills.details, skillId) as Promise<IpcResult<AgentSkill | null>>
  },
  agent: {
    availability: () =>
      ipcRenderer.invoke(IPC.agent.availability) as Promise<IpcResult<AgentAvailability[]>>,
    start: (request: AgentTaskRequest) =>
      ipcRenderer.invoke(IPC.agent.start, request) as Promise<IpcResult<AgentTask>>,
    cancel: (taskId: string) =>
      ipcRenderer.invoke(IPC.agent.cancel, taskId) as Promise<IpcResult<void>>,
    get: (taskId: string) =>
      ipcRenderer.invoke(IPC.agent.get, taskId) as Promise<IpcResult<AgentTask | null>>,
    list: () => ipcRenderer.invoke(IPC.agent.list) as Promise<IpcResult<AgentTask[]>>,
    apply: (request: ApplyChangesRequest) =>
      ipcRenderer.invoke(IPC.agent.apply, request) as Promise<IpcResult<ApplyChangesResult>>,
    discard: (taskId: string) =>
      ipcRenderer.invoke(IPC.agent.discard, taskId) as Promise<IpcResult<void>>,
    onEvent: (listener: (event: AgentTaskEvent) => void) => {
      const handler = (_e: unknown, payload: AgentTaskEvent) => listener(payload)
      ipcRenderer.on(IPC.agent.onEvent, handler)
      return () => ipcRenderer.removeListener(IPC.agent.onEvent, handler)
    }
  }
}

contextBridge.exposeInMainWorld('studio', api)
