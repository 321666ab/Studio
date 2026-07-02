import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeTheme,
  shell
} from 'electron'
import { execFile } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { IPC } from '../shared/types.js'
import {
  electronInputToHotkeyPress,
  matchesHotkeyPress
} from '../shared/hotkeys.js'
import type {
  AgentAvailability,
  AgentTask,
  AgentTaskEvent,
  AgentTaskRequest,
  AgentSkill,
  AgentContextEstimate,
  ApplyChangesRequest,
  ApplyChangesResult,
  IpcResult,
  PathContextMenuResult,
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
import { ClaudeCapabilityService } from './claudeCapability.js'
import { estimateContext } from './contextService.js'
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
let claudeCapabilities: ClaudeCapabilityService | null = null
// Cached settings-derived knobs read by the agent manager on each run.
let lastBypass = true
let lastTimeoutMs = 10 * 60 * 1000
let lastModels = { claude: '', codex: '' }
let lastHotkeys: Settings['hotkeys'] = []
let hotkeysSuspended = false
const registeredHotkeyAccelerators = new Set<string>()
let loginShellPath = process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'

registerPreviewSchemePrivileges()
registerQuickLookSchemePrivileges()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'followWindow',
    backgroundColor: '#00000000',
    transparent: true,
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
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (hotkeysSuspended || input.type !== 'keyDown') return
    const hotkey = lastHotkeys.find((item) =>
      matchesHotkeyPress(
        electronInputToHotkeyPress(input),
        item,
        process.platform === 'darwin'
      )
    )
    if (!hotkey) return
    event.preventDefault()
    triggerCustomHotkey(hotkey)
  })

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

function copyFileToClipboard(filePath: string): void {
  if (process.platform !== 'darwin') {
    clipboard.writeText(filePath)
    return
  }
  const script = 'set the clipboard to (POSIX file (item 1 of argv))'
  execFile('osascript', ['-e', script, filePath], { timeout: 3000 }, (error) => {
    if (error) clipboard.writeText(filePath)
  })
}

function triggerCustomHotkey(hotkey: Settings['hotkeys'][number]): void {
  if (hotkeysSuspended || !mainWindow) return
  console.info(`[hotkeys] triggered ${hotkey.accelerator} -> ${hotkey.action}`)
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
  mainWindow.webContents.send(IPC.hotkeys.onTrigger, {
    action: hotkey.action,
    presetText: hotkey.presetText
  })
}

function getSystemColorScheme(): 'light' | 'dark' {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

function broadcastSystemColorScheme(): void {
  const scheme = getSystemColorScheme()
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(IPC.settings.onSystemColorSchemeChange, scheme)
  })
}

function syncGlobalHotkeys(): void {
  if (!app.isReady()) return
  registeredHotkeyAccelerators.forEach((accelerator) => globalShortcut.unregister(accelerator))
  registeredHotkeyAccelerators.clear()
  if (hotkeysSuspended) return

  const seen = new Set<string>()
  lastHotkeys.forEach((hotkey) => {
    if (!hotkey.enabled) return
    const accelerator = toElectronAccelerator(hotkey.accelerator)
    if (!accelerator || seen.has(accelerator)) return
    seen.add(accelerator)
    if (globalShortcut.register(accelerator, () => triggerCustomHotkey(hotkey))) {
      registeredHotkeyAccelerators.add(accelerator)
      console.info(`[hotkeys] registered ${accelerator} -> ${hotkey.action}`)
    } else {
      console.warn(`[hotkeys] failed to register ${accelerator}`)
    }
  })
}

function toElectronAccelerator(accelerator: string): string | null {
  const parts = accelerator
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length < 2) return null
  const mapped = parts.map((part) => {
    switch (part.toLowerCase()) {
      case 'cmdorctrl':
      case 'commandorcontrol':
        return 'CommandOrControl'
      case 'cmd':
      case 'command':
        return 'Command'
      case 'ctrl':
      case 'control':
        return 'Control'
      case 'alt':
      case 'option':
        return 'Alt'
      case 'shift':
        return 'Shift'
      case 'esc':
        return 'Escape'
      default:
        return part
    }
  })
  return mapped.join('+')
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
      claudeCapabilities?.invalidate()
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
      const result = await new Promise<PathContextMenuResult | null>((resolve) => {
        const done = (action: PathContextMenuResult['action']) => resolve({ action, relativePath: relative })
        const menu = Menu.buildFromTemplate([
          {
            label: '在 Finder 中显示',
            click: () => {
              shell.showItemInFolder(safe)
              done('open-in-finder')
            }
          },
          {
            label: '复制文件',
            click: () => {
              copyFileToClipboard(safe)
              done('copy-file')
            }
          },
          { type: 'separator' },
          {
            label: '复制相对路径',
            click: () => {
              clipboard.writeText(relative)
              done('copy-relative-path')
            }
          }
        ])
        menu.popup({ window: mainWindow ?? undefined, callback: () => resolve(null) })
      })
      return ok(result)
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(
    IPC.fs.estimateContext,
    async (_e, paths: string[]): Promise<IpcResult<AgentContextEstimate>> => {
      try {
        return ok(await estimateContext(projectState.requireRoot(), paths))
      } catch (err) {
        return fail(err)
      }
    }
  )

  // --- Settings ----------------------------------------------------------
  ipcMain.handle(IPC.settings.get, async (): Promise<IpcResult<Settings>> => {
    try {
      return ok(await requireSettings().get())
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(IPC.settings.systemColorScheme, async (): Promise<IpcResult<'light' | 'dark'>> => {
    return ok(getSystemColorScheme())
  })

  ipcMain.handle(
    IPC.settings.update,
    async (_e, patch: SettingsPatch): Promise<IpcResult<Settings>> => {
      try {
        const next = await requireSettings().update(patch ?? {})
        lastBypass = next.ai.bypassPermissions
        lastTimeoutMs = next.ai.taskTimeoutMs
        lastModels = { claude: next.ai.claudeModel, codex: next.ai.codexModel }
        lastHotkeys = next.hotkeys
        syncGlobalHotkeys()
        return ok(next)
      } catch (err) {
        return fail(err)
      }
    }
  )

  ipcMain.on(IPC.hotkeys.setSuspended, (_event, suspended: boolean) => {
    const nextSuspended = suspended === true
    if (hotkeysSuspended === nextSuspended) return
    hotkeysSuspended = nextSuspended
    syncGlobalHotkeys()
  })

  // --- Skills ------------------------------------------------------------
  ipcMain.handle(IPC.skills.list, async (): Promise<IpcResult<AgentSkill[]>> => {
    try {
      return ok(await requireCapabilities().list())
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(IPC.skills.refresh, async (): Promise<IpcResult<AgentSkill[]>> => {
    try {
      return ok(await requireCapabilities().refresh())
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(
    IPC.skills.details,
    async (_e, skillId: string): Promise<IpcResult<AgentSkill | null>> => {
      try {
        return ok(await requireCapabilities().details(skillId))
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

function requireCapabilities(): ClaudeCapabilityService {
  if (!claudeCapabilities) throw new Error('Skill 能力服务尚未就绪')
  return claudeCapabilities
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
  const getAgentExecutable = async (provider: 'claude' | 'codex'): Promise<string> => {
    const result = (await requireAvailability().get(Date.now())).find(
      (item) => item.provider === provider
    )
    if (!result?.available || !result.path) {
      throw new Error(
        `未检测到 ${provider === 'claude' ? 'Claude' : 'Codex'} CLI，请先在终端完成安装和登录`
      )
    }
    return result.path
  }
  claudeCapabilities = new ClaudeCapabilityService(
    () => projectState.get()?.root ?? null,
    () => getAgentExecutable('claude')
  )
  agentTaskManager = new AgentTaskManager({
    getRoot: () => projectState.requireRoot(),
    getBypass: () => lastBypass,
    getTimeoutMs: () => lastTimeoutMs,
    getModel: (provider) => lastModels[provider],
    getSkill: (skillId) => requireCapabilities().details(skillId),
    getExecutable: getAgentExecutable,
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
  lastHotkeys = initialSettings.hotkeys

  registerHandlers()
  nativeTheme.on('updated', broadcastSystemColorScheme)
  createWindow()
  syncGlobalHotkeys()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      syncGlobalHotkeys()
    }
  })
})

app.on('window-all-closed', () => {
  ptyManager?.disposeAll()
  void quickLookService?.clear()
  void agentTaskManager?.disposeAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  registeredHotkeyAccelerators.forEach((accelerator) => globalShortcut.unregister(accelerator))
  registeredHotkeyAccelerators.clear()
})

// Reference the scheme constant so it is part of the module's public surface.
export { PREVIEW_SCHEME }
