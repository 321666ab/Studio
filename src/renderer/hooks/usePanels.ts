import { useCallback, useEffect, useRef, useState } from 'react'

export const LEFT_DEFAULT = 280
export const RIGHT_DEFAULT = 320
const LEFT_MIN = 200
const LEFT_MAX = 460
const RIGHT_MIN = 240
const RIGHT_MAX = 520

interface PanelState {
  leftWidth: number
  rightWidth: number
  leftCollapsed: boolean
  rightCollapsed: boolean
}

const STORAGE_KEY = 'studio.panels.v1'

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
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
      leftWidth: clamp(parsed.leftWidth ?? LEFT_DEFAULT, LEFT_MIN, LEFT_MAX),
      rightWidth: clamp(parsed.rightWidth ?? RIGHT_DEFAULT, RIGHT_MIN, RIGHT_MAX),
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
    (w: number) => setState((s) => ({ ...s, leftWidth: clamp(w, LEFT_MIN, LEFT_MAX) })),
    []
  )
  const setRightWidth = useCallback(
    (w: number) => setState((s) => ({ ...s, rightWidth: clamp(w, RIGHT_MIN, RIGHT_MAX) })),
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

  return {
    ...state,
    toggleLeft,
    toggleRight,
    setLeftWidth,
    setRightWidth,
    resetLeft,
    resetRight
  }
}
