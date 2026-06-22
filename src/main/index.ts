import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { IPC } from '../shared/types.js'
import type { IpcResult, ProjectInfo } from '../shared/types.js'
import { projectState } from './project.js'
import { getFileInfo, readDir, readFileText, writeMarkdown } from './fileService.js'
import { PtyManager, registerPtyHandlers } from './pty.js'
import { resolveWithinRoot } from './security.js'
import {
  PREVIEW_SCHEME,
  registerPreviewProtocol,
  registerPreviewSchemePrivileges
} from './preview.js'
import {
  QuickLookService,
  registerQuickLookSchemePrivileges
} from './quickLook.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
let ptyManager: PtyManager | null = null
let quickLookService: QuickLookService | null = null

registerPreviewSchemePrivileges()
registerQuickLookSchemePrivileges()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function ok<T>(value: T): IpcResult<T> {
  return { ok: true, value }
}

function fail<T>(err: unknown): IpcResult<T> {
  return { ok: false, error: err instanceof Error ? err.message : String(err) }
}

function registerHandlers(): void {
  ipcMain.handle(IPC.project.select, async (): Promise<IpcResult<ProjectInfo | null>> => {
    try {
      const result = await dialog.showOpenDialog({
        title: '选择工程文件夹',
        buttonLabel: '打开',
        properties: ['openDirectory']
      })
      if (result.canceled || result.filePaths.length === 0) return ok(null)
      const info = await projectState.set(result.filePaths[0])
      // Switching projects tears down any live shell.
      ptyManager?.disposeAll()
      await quickLookService?.clear()
      return ok(info)
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(IPC.project.current, async (): Promise<IpcResult<ProjectInfo | null>> => {
    return ok(projectState.get())
  })

  ipcMain.handle(IPC.fs.readDir, async (_e, dirPath: string) => {
    try {
      return ok(await readDir(projectState.requireRoot(), dirPath))
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(IPC.fs.fileInfo, async (_e, filePath: string) => {
    try {
      return ok(await getFileInfo(projectState.requireRoot(), filePath))
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(IPC.fs.readFile, async (_e, filePath: string) => {
    try {
      return ok(await readFileText(projectState.requireRoot(), filePath))
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(IPC.fs.writeMarkdown, async (_e, filePath: string, content: string) => {
    try {
      return ok(await writeMarkdown(projectState.requireRoot(), filePath, content))
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(IPC.fs.openPath, async (_e, targetPath: string) => {
    try {
      const safe = await resolveWithinRoot(projectState.requireRoot(), targetPath)
      await shell.openPath(safe)
      return ok(undefined)
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(IPC.fs.quickLook, async (_e, filePath: string) => {
    try {
      if (!quickLookService) throw new Error('快速预览尚未就绪')
      return ok(await quickLookService.create(projectState.requireRoot(), filePath))
    } catch (err) {
      return fail(err)
    }
  })

  ptyManager = new PtyManager(() => mainWindow?.webContents ?? null)
  registerPtyHandlers(ipcMain, ptyManager, () => projectState.requireRoot())
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Studio',
        submenu: [
          { role: 'about', label: '关于 Studio' },
          { type: 'separator' },
          { role: 'hide', label: '隐藏 Studio' },
          { role: 'hideOthers', label: '隐藏其他应用' },
          { role: 'unhide', label: '全部显示' },
          { type: 'separator' },
          { role: 'quit', label: '退出 Studio' }
        ]
      },
      {
        label: '编辑',
        submenu: [
          { role: 'undo', label: '撤销' },
          { role: 'redo', label: '重做' },
          { type: 'separator' },
          { role: 'cut', label: '剪切' },
          { role: 'copy', label: '复制' },
          { role: 'paste', label: '粘贴' },
          { role: 'selectAll', label: '全选' }
        ]
      },
      {
        label: '视图',
        submenu: [
          { role: 'reload', label: '重新载入' },
          { role: 'toggleDevTools', label: '开发者工具' },
          { type: 'separator' },
          { role: 'resetZoom', label: '实际大小' },
          { role: 'zoomIn', label: '放大' },
          { role: 'zoomOut', label: '缩小' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: '进入全屏幕' }
        ]
      },
      {
        label: '窗口',
        submenu: [
          { role: 'minimize', label: '最小化' },
          { role: 'zoom', label: '缩放' },
          { role: 'front', label: '前置全部窗口' }
        ]
      }
    ])
  )
  registerPreviewProtocol(() => projectState.get()?.root ?? null)
  quickLookService = new QuickLookService(path.join(app.getPath('temp'), 'studio-quicklook'))
  quickLookService.registerProtocol()
  registerHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  ptyManager?.disposeAll()
  void quickLookService?.clear()
  if (process.platform !== 'darwin') app.quit()
})

// Reference the scheme constant so it is part of the module's public surface.
export { PREVIEW_SCHEME }
