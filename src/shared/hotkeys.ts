import type { HotkeySlot } from './types.js'

export interface HotkeyPress {
  key: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export interface ElectronHotkeyInput {
  key: string
  code: string
  meta?: boolean
  control?: boolean
  alt?: boolean
  shift?: boolean
}

export function electronInputToHotkeyPress(input: ElectronHotkeyInput): HotkeyPress {
  return {
    key: input.key,
    code: input.code,
    metaKey: input.meta === true,
    ctrlKey: input.control === true,
    altKey: input.alt === true,
    shiftKey: input.shift === true
  }
}

export function matchesHotkeyPress(
  press: HotkeyPress,
  hotkey: HotkeySlot,
  isMac: boolean
): boolean {
  if (!hotkey.enabled || !hotkey.accelerator.trim()) return false
  const parts = hotkey.accelerator
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length < 2) return false

  const key = parts[parts.length - 1]
  const modifiers = new Set(parts.slice(0, -1).map((part) => part.toLowerCase()))
  const wantsCmdOrCtrl = modifiers.has('cmdorctrl') || modifiers.has('commandorcontrol')
  const wantsMeta =
    modifiers.has('cmd') ||
    modifiers.has('command') ||
    modifiers.has('meta') ||
    modifiers.has('super')
  const wantsCtrl = modifiers.has('ctrl') || modifiers.has('control')
  const wantsAlt = modifiers.has('alt') || modifiers.has('option')
  const wantsShift = modifiers.has('shift')
  const metaExpected = wantsMeta || (wantsCmdOrCtrl && isMac)
  const ctrlExpected = wantsCtrl || (wantsCmdOrCtrl && !isMac)

  return (
    press.metaKey === metaExpected &&
    press.ctrlKey === ctrlExpected &&
    press.altKey === wantsAlt &&
    press.shiftKey === wantsShift &&
    normalizePressKey(press) === normalizeHotkeyKey(key)
  )
}

export function normalizePressKey(press: Pick<HotkeyPress, 'key' | 'code'>): string {
  if (/^Key[A-Z]$/.test(press.code)) return press.code.slice(3).toLowerCase()
  if (/^Digit\d$/.test(press.code)) return press.code.slice(5)
  if (/^Numpad\d$/.test(press.code)) return `num${press.code.slice(6)}`
  const codeAliases: Record<string, string> = {
    Space: 'space',
    Minus: 'minus',
    Equal: 'equal',
    BracketLeft: 'bracketleft',
    BracketRight: 'bracketright',
    Backslash: 'backslash',
    Semicolon: 'semicolon',
    Quote: 'quote',
    Comma: 'comma',
    Period: 'period',
    Slash: 'slash',
    Backquote: 'backquote'
  }
  return codeAliases[press.code] ?? normalizeHotkeyKey(press.key)
}

export function normalizeHotkeyKey(value: string): string {
  const lower = value.toLowerCase()
  if (lower === ' ') return 'space'
  if (lower === '+' || lower === 'plus') return 'plus'
  if (lower === '-' || lower === 'minus') return 'minus'
  if (lower === '=' || lower === 'equal') return 'equal'
  if (lower === 'esc') return 'escape'
  if (lower === 'return') return 'enter'
  if (lower === 'arrowup') return 'up'
  if (lower === 'arrowdown') return 'down'
  if (lower === 'arrowleft') return 'left'
  if (lower === 'arrowright') return 'right'
  return lower
}
