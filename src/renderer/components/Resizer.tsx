import { useCallback, useEffect, useRef, useState } from 'react'

interface ResizerProps {
  /** Current width of the panel being resized. */
  width: number
  /** Which edge the panel sits on relative to this handle. */
  side: 'left' | 'right'
  onResize: (width: number) => void
  /** Double-click restores the default width. */
  onReset: () => void
}

/**
 * Draggable divider. Tracks pointer deltas from the drag origin and reports a
 * new width; double-click resets. While dragging it captures the pointer and
 * forces the col-resize cursor document-wide.
 */
export function Resizer({ width, side, onResize, onReset }: ResizerProps): JSX.Element {
  const [dragging, setDragging] = useState(false)
  const origin = useRef({ x: 0, w: 0 })

  const onMove = useCallback(
    (e: PointerEvent) => {
      const delta = e.clientX - origin.current.x
      const next = side === 'left' ? origin.current.w + delta : origin.current.w - delta
      onResize(next)
    },
    [side, onResize]
  )

  const onUp = useCallback(() => setDragging(false), [])

  useEffect(() => {
    if (!dragging) return
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
    }
  }, [dragging, onMove, onUp])

  return (
    <div
      className={`resizer${dragging ? ' dragging' : ''}`}
      onPointerDown={(e) => {
        origin.current = { x: e.clientX, w: width }
        setDragging(true)
      }}
      onDoubleClick={onReset}
      role="separator"
      aria-orientation="vertical"
    />
  )
}
