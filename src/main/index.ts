import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { IPC } from '../shared/types.js'
import type {
  AgentAvailability,
  AgentTask,
  AgentTaskEvent,
  AgentTaskRequest,
  ApplyChangesRequest,
  ApplyChangesResult,
  IpcResult,
  ProjectInfo,
  Settings,
  SettingsPatch
} from '../shared/types.js'
import { projectState } from './project.js'
import { getFileInfo, readDir, readFileText, writeMarkdown } from './fileService.js'
import { PtyManager, registerPtyHandlers } from './pty.js'
import { resolveWithinRoot } from './security.js'
import { SettingsStore, defaultSettingsPath } from './settings.js'
import { AgentAvailabilityCache, detectLoginShellPath } from './agentAvailability.js'
import { AgentTaskManager } from './agentTaskManager.js'
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
let settingsStore: SettingsStore | null = null
let agentAvailability: AgentAvailabilityCache | null = null
let agentTaskManager: AgentTaskManager | null = null
// Cached settings-derived knobs read by the agent manager on each run.
let lastBypass = true
let lastTimeoutMs = 10 * 60 * 1000
let lastModels = { claude: '', codex: '' }
let loginShellPath = process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'

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
      await requireSettings().update({ general: { lastProjectPath: info.root } })
      // Switching projects tears down any live shell.
      ptyManager?.disposeAll()
      await quickLookService?.clear()
      await agentTaskManager?.disposeAll()
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

  ipcMain.handle(IPC.fs.showPathContextMenu, async (_e, targetPath: string) => {
    try {
      const root = projectState.requireRoot()
      const safe = await resolveWithinRoot(root, targetPath)
      const relative = path.relative(root, safe).split(path.sep).join('/') || '.'
      await new Promise<void>((resolve) => {
        const menu = Menu.buildFromTemplate([
          {
            label: '复制相对路径',
            click: () => clipboard.writeText(relative)
          }
        ])
        menu.popup({ window: mainWindow ?? undefined, callback: resolve })
      })
      return ok(undefined)
    } catch (err) {
      return fail(err)
    }
  })

  // --- Settings ----------------------------------------------------------
  ipcMain.handle(IPC.settings.get, async (): Promise<IpcResult<Settings>> => {
    try {
      return ok(await requireSettings().get())
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(
    IPC.settings.update,
    async (_e, patch: SettingsPatch): Promise<IpcResult<Settings>> => {
      try {
        const next = await requireSettings().update(patch ?? {})
        lastBypass = next.ai.bypassPermissions
        lastTimeoutMs = next.ai.taskTimeoutMs
        lastModels = { claude: next.ai.claudeModel, codex: next.ai.codexModel }
        return ok(next)
      } catch (err) {
        return fail(err)
      }
    }
  )

  // --- Agents ------------------------------------------------------------
  ipcMain.handle(IPC.agent.availability, async (): Promise<IpcResult<AgentAvailability[]>> => {
    try {
      return ok(await requireAvailability().get(Date.now()))
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(
    IPC.agent.start,
    async (_e, request: AgentTaskRequest): Promise<IpcResult<AgentTask>> => {
      try {
        return ok(await requireAgentManager().start(request))
      } catch (err) {
        return fail(err)
      }
    }
  )

  ipcMain.handle(IPC.agent.cancel, async (_e, taskId: string): Promise<IpcResult<void>> => {
    try {
      await requireAgentManager().cancel(taskId)
      return ok(undefined)
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(IPC.agent.get, async (_e, taskId: string): Promise<IpcResult<AgentTask | null>> => {
    try {
      return ok(requireAgentManager().get(taskId))
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(IPC.agent.list, async (): Promise<IpcResult<AgentTask[]>> => {
    try {
      return ok(requireAgentManager().list())
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(
    IPC.agent.apply,
    async (_e, request: ApplyChangesRequest): Promise<IpcResult<ApplyChangesResult>> => {
      try {
        return ok(await requireAgentManager().apply(request))
      } catch (err) {
        return fail(err)
      }
    }
  )

  ipcMain.handle(IPC.agent.discard, async (_e, taskId: string): Promise<IpcResult<void>> => {
    try {
      await requireAgentManager().discard(taskId)
      return ok(undefined)
    } catch (err) {
      return fail(err)
    }
  })

  ptyManager = new PtyManager(() => mainWindow?.webContents ?? null)
  registerPtyHandlers(ipcMain, ptyManager, () => projectState.requireRoot())
}

function requireSettings(): SettingsStore {
  if (!settingsStore) throw new Error('设置尚未就绪')
  return settingsStore
}

function requireAvailability(): AgentAvailabilityCache {
  if (!agentAvailability) throw new Error('代理检测尚未就绪')
  return agentAvailability
}

function requireAgentManager(): AgentTaskManager {
  if (!agentTaskManager) throw new Error('任务管理器尚未就绪')
  return agentTaskManager
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Studio',
        submenu: [
          { role: 'about', label: '关于 Studio' },
          { type: 'separator' },
          {
            label: '设置…',
            accelerator: 'CmdOrCtrl+,',
            click: () => mainWindow?.webContents.send(IPC.settings.onOpen)
          },
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

  settingsStore = new SettingsStore(defaultSettingsPath(app.getPath('userData')))
  loginShellPath = await detectLoginShellPath()
  const initialSettings = await settingsStore.get()
  if (initialSettings.general.restoreLastProject && initialSettings.general.lastProjectPath) {
    await projectState.set(initialSettings.general.lastProjectPath).catch(() => undefined)
  }
  agentAvailability = new AgentAvailabilityCache()
  agentTaskManager = new AgentTaskManager({
    getRoot: () => projectState.requireRoot(),
    getBypass: () => lastBypass,
    getTimeoutMs: () => lastTimeoutMs,
    getModel: (provider) => lastModels[provider],
    getExecutable: async (provider) => {
      const result = (await requireAvailability().get(Date.now())).find(
        (item) => item.provider === provider
      )
      if (!result?.available || !result.path) {
        throw new Error(
          `未检测到 ${provider === 'claude' ? 'Claude' : 'Codex'} CLI，请先在终端完成安装和登录`
        )
      }
      return result.path
    },
    getLoginPath: () => loginShellPath,
    emit: (event: AgentTaskEvent) => mainWindow?.webContents.send(IPC.agent.onEvent, event)
  })
  // Seed the manager's settings-derived knobs and keep them current on update.
  lastBypass = initialSettings.ai.bypassPermissions
  lastTimeoutMs = initialSettings.ai.taskTimeoutMs
  lastModels = {
    claude: initialSettings.ai.claudeModel,
    codex: initialSettings.ai.codexModel
  }

  registerHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  ptyManager?.disposeAll()
  void quickLookService?.clear()
  void agentTaskManager?.disposeAll()
  if (process.platform !== 'darwin') app.quit()
})

// Reference the scheme constant so it is part of the module's public surface.
export { PREVIEW_SCHEME }
