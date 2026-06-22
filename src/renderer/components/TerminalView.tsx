import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { PtyAgent } from '../../shared/types'
import '@xterm/xterm/css/xterm.css'

export type TerminalTaskStatus = 'starting' | 'idle' | 'active' | 'exited' | 'error'

interface TerminalViewProps {
  terminalId: string
  agent: PtyAgent
  projectKey: string | null
  active: boolean
  fontSize: number
  scrollback: number
  onStatusChange: (status: TerminalTaskStatus) => void
}

export function TerminalView({
  terminalId,
  agent,
  projectKey,
  active,
  fontSize,
  scrollback,
  onStatusChange
}: TerminalViewProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const statusRef = useRef<TerminalTaskStatus>('starting')
  const idleTimerRef = useRef<number | null>(null)
  const statusChangeRef = useRef(onStatusChange)

  useEffect(() => {
    statusChangeRef.current = onStatusChange
  }, [onStatusChange])

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
      fontFamily: "'SF Mono', ui-monospace, Menlo, monospace",
      fontSize,
      lineHeight: 1.25,
      scrollback,
      cursorBlink: true,
      theme: {
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
        brightBlack: '#8c959f',
        brightRed: '#a40e26',
        brightGreen: '#1a7f37',
        brightYellow: '#bf8700',
        brightBlue: '#218bff',
        brightMagenta: '#a475f9',
        brightCyan: '#3192aa',
        brightWhite: '#24292f'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
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
    requestAnimationFrame(() => {
      try {
        fit?.fit()
      } catch {
        // The pane may be hidden while settings change.
      }
    })
  }, [fontSize, scrollback])

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

  return <div className="term-host" ref={hostRef} role="region" aria-label="Agent 终端" />
}
