import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import type { PtyAgent, ResolvedColorScheme } from '../../shared/types'
import { api } from '../lib/api'
import '@xterm/xterm/css/xterm.css'

export type TerminalTaskStatus = 'starting' | 'idle' | 'active' | 'exited' | 'error'

interface TerminalViewProps {
  terminalId: string
  agent: PtyAgent
  projectKey: string | null
  active: boolean
  fontSize: number
  scrollback: number
  fontFamily: string
  lineHeight: number
  letterSpacing: number
  colorScheme: ResolvedColorScheme
  onFocus: () => void
  onStatusChange: (status: TerminalTaskStatus) => void
}

const DEFAULT_FONT_STACK = "'SF Mono', ui-monospace, Menlo, monospace"

const LIGHT_THEME: ITheme = {
  background: '#fbfbfc',
  foreground: '#252529',
  cursor: '#0a5fdc',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(10,95,220,0.18)',
  black: '#1f2328',
  red: '#cf222e',
  green: '#116329',
  yellow: '#9a6700',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
  brightBlack: '#57606a',
  brightRed: '#a40e26',
  brightGreen: '#1a7f37',
  brightYellow: '#9a6700',
  brightBlue: '#218bff',
  brightMagenta: '#8250df',
  brightCyan: '#3192aa',
  brightWhite: '#24292f'
}

const DARK_THEME: ITheme = {
  background: '#17181c',
  foreground: '#e6e6ea',
  cursor: '#58a6ff',
  cursorAccent: '#17181c',
  selectionBackground: 'rgba(88,166,255,0.30)',
  black: '#3b3f46',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#b1bac4',
  brightBlack: '#8b949e',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f6fc'
}

export interface TerminalViewHandle {
  focus: () => void
}

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(function TerminalView({
  terminalId,
  agent,
  projectKey,
  active,
  fontSize,
  scrollback,
  fontFamily,
  lineHeight,
  letterSpacing,
  colorScheme,
  onFocus,
  onStatusChange
}: TerminalViewProps, ref): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const statusRef = useRef<TerminalTaskStatus>('starting')
  const idleTimerRef = useRef<number | null>(null)
  const statusChangeRef = useRef(onStatusChange)
  const focusRef = useRef(onFocus)

  useImperativeHandle(ref, () => ({
    focus: () => {
      termRef.current?.focus()
      focusRef.current()
    }
  }), [])

  useEffect(() => {
    statusChangeRef.current = onStatusChange
  }, [onStatusChange])

  useEffect(() => {
    focusRef.current = onFocus
  }, [onFocus])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const setStatus = (status: TerminalTaskStatus): void => {
      if (statusRef.current === status) return
      statusRef.current = status
      statusChangeRef.current(status)
    }

    const scheduleIdle = (): void => {
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current)
      idleTimerRef.current = window.setTimeout(() => {
        if (statusRef.current === 'active') setStatus('idle')
      }, 2200)
    }

    const term = new Terminal({
      // Proposed APIs are needed by the Unicode 11 addon for CJK/emoji widths.
      allowProposedApi: true,
      fontFamily: fontFamily.trim() || DEFAULT_FONT_STACK,
      fontSize,
      lineHeight,
      letterSpacing,
      scrollback,
      cursorBlink: true,
      minimumContrastRatio: 4.5,
      theme: colorScheme === 'dark' ? DARK_THEME : LIGHT_THEME
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        event.preventDefault()
        void api.openExternalUrl(uri).catch(() => undefined)
      })
    )
    term.open(host)
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch {
      // GPU rendering is a progressive enhancement; DOM renderer remains.
    }
    termRef.current = term
    fitRef.current = fit

    const offData = window.studio.pty.onData((event) => {
      if (event.terminalId !== terminalId) return
      term.write(event.data)
      setStatus('active')
      scheduleIdle()
    })
    const offExit = window.studio.pty.onExit((event) => {
      if (event.terminalId !== terminalId) return
      term.writeln(`\r\n\x1b[90m[进程已退出，代码 ${event.exitCode}]\x1b[0m`)
      setStatus(event.exitCode === 0 ? 'exited' : 'error')
    })
    const inputSub = term.onData((data) => {
      window.studio.pty.input(terminalId, data)
      focusRef.current()
      if (data.includes('\r') || data.includes('\n')) {
        setStatus('active')
        scheduleIdle()
      }
    })

    return () => {
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current)
      offData()
      offExit()
      inputSub.dispose()
      window.studio.pty.dispose(terminalId)
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [terminalId])

  useEffect(() => {
    const term = termRef.current
    const fit = fitRef.current
    if (!term) return
    term.options.fontSize = fontSize
    term.options.scrollback = scrollback
    term.options.fontFamily = fontFamily.trim() || DEFAULT_FONT_STACK
    term.options.lineHeight = lineHeight
    term.options.letterSpacing = letterSpacing
    term.options.theme = colorScheme === 'dark' ? DARK_THEME : LIGHT_THEME
    requestAnimationFrame(() => {
      try {
        fit?.fit()
      } catch {
        // The pane may be hidden while settings change.
      }
    })
  }, [colorScheme, fontFamily, fontSize, letterSpacing, lineHeight, scrollback])

  useEffect(() => {
    const term = termRef.current
    const fit = fitRef.current
    if (!term || !fit || !projectKey) return

    statusRef.current = 'starting'
    statusChangeRef.current('starting')
    term.reset()
    requestAnimationFrame(() => {
      try {
        fit.fit()
      } catch {
        // Host may still be hidden.
      }
      window.studio.pty
        .create({ terminalId, agent, cols: term.cols || 80, rows: term.rows || 24 })
        .then((result) => {
          if (!result.ok) {
            term.writeln(`\x1b[31m终端启动失败：${result.error}\x1b[0m`)
            statusRef.current = 'error'
            statusChangeRef.current('error')
          } else {
            statusRef.current = 'idle'
            statusChangeRef.current('idle')
          }
        })
    })
  }, [agent, projectKey, terminalId])

  useEffect(() => {
    const host = hostRef.current
    const term = termRef.current
    const fit = fitRef.current
    if (!host || !term || !fit) return

    const doFit = (): void => {
      if (!active) return
      try {
        fit.fit()
        window.studio.pty.resize(terminalId, term.cols, term.rows)
      } catch {
        // Ignore transient layout races.
      }
    }
    const observer = new ResizeObserver(doFit)
    observer.observe(host)
    requestAnimationFrame(doFit)
    return () => observer.disconnect()
  }, [active, terminalId])

  return (
    <div
      className="term-host"
      ref={hostRef}
      role="region"
      aria-label="Agent 终端"
      onMouseDown={onFocus}
    />
  )
})
