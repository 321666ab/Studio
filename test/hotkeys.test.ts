import { describe, expect, it } from 'vitest'
import {
  electronInputToHotkeyPress,
  matchesHotkeyPress
} from '../src/shared/hotkeys.js'
import type { HotkeySlot } from '../src/shared/types.js'

function hotkey(accelerator: string): HotkeySlot {
  return {
    id: 1,
    enabled: true,
    accelerator,
    action: 'focus-claude-terminal',
    presetText: ''
  }
}

describe('hotkey matching', () => {
  it('matches command-shift letter hotkeys from Electron before-input-event', () => {
    const press = electronInputToHotkeyPress({
      key: 'Z',
      code: 'KeyZ',
      meta: true,
      shift: true
    })

    expect(matchesHotkeyPress(press, hotkey('CmdOrCtrl+Shift+Z'), true)).toBe(true)
  })

  it('matches shifted physical digit keys by code instead of the produced symbol', () => {
    const press = electronInputToHotkeyPress({
      key: '!',
      code: 'Digit1',
      meta: true,
      shift: true
    })

    expect(matchesHotkeyPress(press, hotkey('CmdOrCtrl+Shift+1'), true)).toBe(true)
  })

  it('matches recommended command-option digit hotkeys', () => {
    const press = electronInputToHotkeyPress({
      key: '1',
      code: 'Digit1',
      meta: true,
      alt: true
    })

    expect(matchesHotkeyPress(press, hotkey('CmdOrCtrl+Alt+1'), true)).toBe(true)
  })
})
