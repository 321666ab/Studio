import { useCallback, useEffect, useRef, useState } from 'react'

export const LEFT_DEFAULT = 280
export const RIGHT_DEFAULT = 320

interface PanelState {
  leftWidth: number
  rightWidth: number
  leftCollapsed: boolean
  rightCollapsed: boolean
}

const STORAGE_KEY = 'studio.panels.v1'

function normalizeWidth(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.round(value))
}

function load(): PanelState {
  const fallback: PanelState = {
    leftWidth: LEFT_DEFAULT,
    rightWidth: RIGHT_DEFAULT,
    leftCollapsed: false,
    rightCollapsed: false
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<PanelState>
    return {
      leftWidth: normalizeWidth(parsed.leftWidth, LEFT_DEFAULT),
      rightWidth: normalizeWidth(parsed.rightWidth, RIGHT_DEFAULT),
      leftCollapsed: !!parsed.leftCollapsed,
      rightCollapsed: !!parsed.rightCollapsed
    }
  } catch {
    return fallback
  }
}

export interface PanelsController {
  leftWidth: number
  rightWidth: number
  leftCollapsed: boolean
  rightCollapsed: boolean
  toggleLeft: () => void
  toggleRight: () => void
  setLeftWidth: (w: number) => void
  setRightWidth: (w: number) => void
  resetLeft: () => void
  resetRight: () => void
  replaceWidths: (leftWidth: number, rightWidth: number) => void
  resetAll: () => void
}

export function usePanels(): PanelsController {
  const [state, setState] = useState<PanelState>(load)
  const saveTimer = useRef<number | undefined>(undefined)

  // Debounced persistence so dragging doesn't thrash localStorage.
  useEffect(() => {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    }, 200)
    return () => window.clearTimeout(saveTimer.current)
  }, [state])

  const toggleLeft = useCallback(
    () => setState((s) => ({ ...s, leftCollapsed: !s.leftCollapsed })),
    []
  )
  const toggleRight = useCallback(
    () => setState((s) => ({ ...s, rightCollapsed: !s.rightCollapsed })),
    []
  )
  const setLeftWidth = useCallback(
    (w: number) => setState((s) => ({ ...s, leftWidth: normalizeWidth(w, s.leftWidth) })),
    []
  )
  const setRightWidth = useCallback(
    (w: number) => setState((s) => ({ ...s, rightWidth: normalizeWidth(w, s.rightWidth) })),
    []
  )
  const resetLeft = useCallback(
    () => setState((s) => ({ ...s, leftWidth: LEFT_DEFAULT })),
    []
  )
  const resetRight = useCallback(
    () => setState((s) => ({ ...s, rightWidth: RIGHT_DEFAULT })),
    []
  )
  const replaceWidths = useCallback(
    (leftWidth: number, rightWidth: number) =>
      setState((s) => ({
        ...s,
        leftWidth: normalizeWidth(leftWidth, s.leftWidth),
        rightWidth: normalizeWidth(rightWidth, s.rightWidth)
      })),
    []
  )
  const resetAll = useCallback(
    () =>
      setState({
        leftWidth: LEFT_DEFAULT,
        rightWidth: RIGHT_DEFAULT,
        leftCollapsed: false,
        rightCollapsed: false
      }),
    []
  )

  return {
    ...state,
    toggleLeft,
    toggleRight,
    setLeftWidth,
    setRightWidth,
    resetLeft,
    resetRight,
    replaceWidths,
    resetAll
  }
}
