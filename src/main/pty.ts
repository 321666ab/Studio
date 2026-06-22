import type { IpcMain, WebContents } from 'electron'
import os from 'os'
import * as pty from 'node-pty'
import { IPC } from '../shared/types.js'
import type { PtyAgent, PtyCreateOptions } from '../shared/types.js'

export class PtyManager {
  private readonly processes = new Map<string, pty.IPty>()

  constructor(private readonly getWebContents: () => WebContents | null) {}

  create(cwd: string, options: PtyCreateOptions): void {
    const terminalId = validTerminalId(options?.terminalId)
    this.dispose(terminalId)
    const cols = validDimension(options?.cols, 80)
    const rows = validDimension(options?.rows, 24)
    const shell = process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : 'bash')
    const launch = createPtyLaunch(validPtyAgent(options?.agent), shell)
    const proc = pty.spawn(launch.file, launch.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: createPtyEnvironment()
    })
    this.processes.set(terminalId, proc)

    proc.onData((data) => {
      this.getWebContents()?.send(IPC.pty.onData, { terminalId, data })
    })
    proc.onExit(({ exitCode, signal }) => {
      this.getWebContents()?.send(IPC.pty.onExit, { terminalId, exitCode, signal })
      if (this.processes.get(terminalId) === proc) this.processes.delete(terminalId)
    })
  }

  input(terminalId: string, data: string): void {
    if (typeof data === 'string' && data.length <= 64 * 1024) {
      this.processes.get(validTerminalId(terminalId))?.write(data)
    }
  }

  resize(terminalId: string, cols: number, rows: number): void {
    const proc = this.processes.get(validTerminalId(terminalId))
    if (!proc) return
    try {
      proc.resize(validDimension(cols, 80), validDimension(rows, 24))
    } catch {
      // Ignore resize races with an exited process.
    }
  }

  dispose(terminalId: string): void {
    const id = validTerminalId(terminalId)
    const proc = this.processes.get(id)
    if (!proc) return
    try {
      proc.kill()
    } catch {
      // Already exited.
    }
    this.processes.delete(id)
  }

  disposeAll(): void {
    for (const terminalId of [...this.processes.keys()]) this.dispose(terminalId)
  }
}

export function registerPtyHandlers(
  ipcMain: IpcMain,
  manager: PtyManager,
  getRoot: () => string
): void {
  ipcMain.handle(IPC.pty.create, (_event, options: PtyCreateOptions) => {
    try {
      manager.create(getRoot(), options)
      return { ok: true, value: undefined }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  })

  ipcMain.on(
    IPC.pty.input,
    (_event, payload: { terminalId: string; data: string }) =>
      manager.input(payload?.terminalId, payload?.data)
  )

  ipcMain.on(
    IPC.pty.resize,
    (_event, payload: { terminalId: string; cols: number; rows: number }) =>
      manager.resize(payload?.terminalId, payload?.cols, payload?.rows)
  )

  ipcMain.on(IPC.pty.dispose, (_event, terminalId: string) => {
    manager.dispose(terminalId)
  })
}

/**
 * Apps launched from Finder do not reliably inherit a UTF-8 locale. Without
 * this, zsh renders Chinese project paths as escaped `\M-...` byte sequences.
 */
export function createPtyEnvironment(
  source: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') env[key] = value
  }
  // Codex itself is launched with NO_COLOR=1. Do not leak that into the user's
  // shell: it disables ANSI styling in Claude and most modern CLI programs.
  delete env.NO_COLOR
  env.LANG = 'en_US.UTF-8'
  env.LC_CTYPE = 'en_US.UTF-8'
  env.LC_ALL = 'en_US.UTF-8'
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'Studio'
  env.FORCE_COLOR = '3'
  env.CLICOLOR = '1'
  env.CLICOLOR_FORCE = '1'
  return env
}

export function createPtyLaunch(
  agent: PtyAgent,
  shell = process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : 'bash')
): { file: string; args: string[] } {
  const command =
    agent === 'claude'
      ? 'exec claude --dangerously-skip-permissions'
      : 'exec codex --dangerously-bypass-approvals-and-sandbox'
  return { file: shell, args: ['-l', '-c', command] }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function validTerminalId(value: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) {
    throw new Error('终端标识无效')
  }
  return value
}

function validPtyAgent(value: unknown): PtyAgent {
  if (value !== 'claude' && value !== 'codex') throw new Error('终端类型无效')
  return value
}

function validDimension(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 && value <= 1000 ? value : fallback
}
