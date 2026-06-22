import type {
  DirEntry,
  FileInfo,
  IpcResult,
  ProjectInfo,
  QuickLookPreview,
  ReadFileResult,
  WriteFileResult
} from '../../shared/types'

/**
 * Thin promise-based wrapper over window.studio that unwraps IpcResult and
 * throws on failure, so callers can use plain try/catch.
 */
function unwrap<T>(res: IpcResult<T>): T {
  if (res.ok) return res.value
  throw new Error(res.error)
}

export const api = {
  async selectProject(): Promise<ProjectInfo | null> {
    return unwrap(await window.studio.selectProject())
  },
  async getCurrentProject(): Promise<ProjectInfo | null> {
    return unwrap(await window.studio.getCurrentProject())
  },
  async readDir(dirPath: string): Promise<DirEntry[]> {
    return unwrap(await window.studio.readDir(dirPath))
  },
  async getFileInfo(filePath: string): Promise<FileInfo> {
    return unwrap(await window.studio.getFileInfo(filePath))
  },
  async readFile(filePath: string): Promise<ReadFileResult> {
    return unwrap(await window.studio.readFile(filePath))
  },
  async writeMarkdown(filePath: string, content: string): Promise<WriteFileResult> {
    return unwrap(await window.studio.writeMarkdown(filePath, content))
  },
  async openPath(targetPath: string): Promise<void> {
    return unwrap(await window.studio.openPath(targetPath))
  },
  async quickLook(filePath: string): Promise<QuickLookPreview> {
    return unwrap(await window.studio.quickLook(filePath))
  }
}
