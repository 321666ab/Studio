import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types.js'
import type {
  DirEntry,
  FileInfo,
  IpcResult,
  ProjectInfo,
  PtyCreateOptions,
  PtyDataEvent,
  PtyExitEvent,
  ReadFileResult,
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
  }
}

contextBridge.exposeInMainWorld('studio', api)
